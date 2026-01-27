import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { visibleWidth } from "@mariozechner/pi-tui";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ColorScheme, SegmentContext, StatusLinePreset, StatusLineSegmentId } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getSeparator } from "./separators.js";
import { renderSegment } from "./segments.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.js";
import { getDefaultColors } from "./theme.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

interface PowerlineConfig {
  preset: StatusLinePreset;
}

let config: PowerlineConfig = {
  preset: "default",
};

// Check if quietStartup is enabled in settings
function isQuietStartup(): boolean {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const settingsPath = join(homeDir, ".pi", "agent", "settings.json");
  
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      return settings.quietStartup === true;
    }
  } catch {}
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Line Builder (for top border)
// ═══════════════════════════════════════════════════════════════════════════

/** Render a single segment and return its content with width */
function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

/** Build status content from a list of segment IDs */
function buildStatusContentFromSegments(
  segmentIds: StatusLineSegmentId[],
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>
): string {
  const separatorDef = getSeparator(presetDef.separator);
  const sepAnsi = getFgAnsiCode("sep");

  // Collect visible segment contents
  const parts: string[] = [];
  for (const segId of segmentIds) {
    const rendered = renderSegment(segId, ctx);
    if (rendered.visible && rendered.content) {
      parts.push(rendered.content);
    }
  }

  if (parts.length === 0) {
    return "";
  }

  // Build content with powerline separators (no background)
  const sep = separatorDef.left;
  return " " + parts.join(` ${sepAnsi}${sep}${ansi.reset} `) + ansi.reset + " ";
}

/** Build content string from pre-rendered parts */
function buildContentFromParts(
  parts: string[],
  presetDef: ReturnType<typeof getPreset>
): string {
  if (parts.length === 0) return "";
  const separatorDef = getSeparator(presetDef.separator);
  const sepAnsi = getFgAnsiCode("sep");
  const sep = separatorDef.left;
  return " " + parts.join(` ${sepAnsi}${sep}${ansi.reset} `) + ansi.reset + " ";
}

/**
 * Responsive segment layout - fits segments into top bar, overflows to secondary row.
 * When terminal is wide enough, secondary segments move up to top bar.
 * When narrow, top bar segments overflow down to secondary row.
 */
function computeResponsiveLayout(
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>,
  availableWidth: number
): { topContent: string; secondaryContent: string } {
  const separatorDef = getSeparator(presetDef.separator);
  const sepWidth = visibleWidth(separatorDef.left) + 2; // separator + spaces around it
  
  // Get all segments: primary first, then secondary
  const primaryIds = [...presetDef.leftSegments, ...presetDef.rightSegments];
  const secondaryIds = presetDef.secondarySegments ?? [];
  const allSegmentIds = [...primaryIds, ...secondaryIds];
  
  // Render all segments and get their widths
  const renderedSegments: { id: StatusLineSegmentId; content: string; width: number }[] = [];
  for (const segId of allSegmentIds) {
    const { content, width, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      renderedSegments.push({ id: segId, content, width });
    }
  }
  
  if (renderedSegments.length === 0) {
    return { topContent: "", secondaryContent: "" };
  }
  
  // Calculate how many segments fit in top bar
  // Account for: leading space (1) + trailing space (1) = 2 chars overhead
  const baseOverhead = 2;
  let currentWidth = baseOverhead;
  let topSegments: string[] = [];
  let secondarySegments: string[] = [];
  let overflow = false;
  
  for (let i = 0; i < renderedSegments.length; i++) {
    const seg = renderedSegments[i];
    // Width needed: segment width + separator (except for first segment)
    const neededWidth = seg.width + (topSegments.length > 0 ? sepWidth : 0);
    
    if (!overflow && currentWidth + neededWidth <= availableWidth) {
      // Fits in top bar
      topSegments.push(seg.content);
      currentWidth += neededWidth;
    } else {
      // Overflow to secondary row
      overflow = true;
      secondarySegments.push(seg.content);
    }
  }
  
  return {
    topContent: buildContentFromParts(topSegments, presetDef),
    secondaryContent: buildContentFromParts(secondarySegments, presetDef),
  };
}

/** Build primary status content (for top border) - legacy, used during streaming */
function buildStatusContent(ctx: SegmentContext, presetDef: ReturnType<typeof getPreset>): string {
  const allSegments = [...presetDef.leftSegments, ...presetDef.rightSegments];
  return buildStatusContentFromSegments(allSegments, ctx, presetDef);
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function powerlineFooter(pi: ExtensionAPI) {
  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let isStreaming = false;
  let tuiRef: any = null; // Store TUI reference for forcing re-renders
  let dismissWelcomeOverlay: (() => void) | null = null; // Callback to dismiss welcome overlay
  let welcomeHeaderActive = false; // Track if welcome header should be cleared on first input
  let welcomeOverlayShouldDismiss = false; // Track early dismissal request (before overlay setup completes)
  
  // Cache for responsive layout (shared between editor and widget for consistency)
  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;

  // Track session start
  pi.on("session_start", async (_event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;
    
    // Store thinking level getter if available
    if (typeof ctx.getThinkingLevel === 'function') {
      getThinkingLevelFn = () => ctx.getThinkingLevel();
    }
    
    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
      // quietStartup: true → compact header, otherwise → full overlay
      if (isQuietStartup()) {
        setupWelcomeHeader(ctx);
      } else {
        setupWelcomeOverlay(ctx);
      }
    }
  });

  // Check if a bash command might change git branch
  const mightChangeGitBranch = (cmd: string): boolean => {
    const gitBranchPatterns = [
      /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
      /\bgit\s+stash\s+(pop|apply)/,
    ];
    return gitBranchPatterns.some(p => p.test(cmd));
  };

  // Invalidate git status on file changes, trigger re-render on potential branch changes
  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
    // Check for bash commands that might change git branch
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        // Invalidate caches since working tree state changes with branch
        invalidateGitStatus();
        invalidateGitBranch();
        // Small delay to let git update, then re-render
        setTimeout(() => tuiRef?.requestRender(), 100);
      }
    }
  });

  // Also catch user escape commands (! prefix)
  // Note: This fires BEFORE execution, so we use a longer delay and multiple re-renders
  // to ensure we catch the update after the command completes.
  pi.on("user_bash", async (event, _ctx) => {
    if (mightChangeGitBranch(event.command)) {
      // Invalidate immediately so next render fetches fresh data
      invalidateGitStatus();
      invalidateGitBranch();
      // Multiple staggered re-renders to catch fast and slow commands
      setTimeout(() => tuiRef?.requestRender(), 100);
      setTimeout(() => tuiRef?.requestRender(), 300);
      setTimeout(() => tuiRef?.requestRender(), 500);
    }
  });

  // Track streaming state (footer only shows status during streaming)
  // Also dismiss welcome when agent starts responding (handles `p "command"` case)
  pi.on("stream_start", async (_event, ctx) => {
    isStreaming = true;
    dismissWelcome(ctx);
  });

  // Also dismiss on tool calls (agent is working)
  pi.on("tool_call", async (_event, ctx) => {
    dismissWelcome(ctx);
  });

  // Helper to dismiss welcome overlay/header
  function dismissWelcome(ctx: any) {
    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      // Overlay not set up yet (100ms delay) - mark for immediate dismissal when it does
      welcomeOverlayShouldDismiss = true;
    }
    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  }

  pi.on("stream_end", async () => {
    isStreaming = false;
  });

  // Dismiss welcome overlay/header on first user message
  pi.on("user_message", async (_event, ctx) => {
    dismissWelcome(ctx);
  });

  // Command to toggle/configure
  pi.registerCommand("powerline", {
    description: "Configure powerline status (toggle, preset)",
    handler: async (args, ctx) => {
      // Update context reference (command ctx may have more methods)
      currentCtx = ctx;
      
      if (!args) {
        // Toggle
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          // Clear all custom UI components
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          footerDataRef = null;
          tuiRef = null;
          // Clear layout cache
          lastLayoutResult = null;
          ctx.ui.notify("Defaults restored", "info");
        }
        return;
      }

      // Check if args is a preset name
      const preset = args.trim().toLowerCase() as StatusLinePreset;
      if (preset in PRESETS) {
        config.preset = preset;
        // Invalidate layout cache since preset changed
        lastLayoutResult = null;
        if (enabled) {
          setupCustomEditor(ctx);
        }
        ctx.ui.notify(`Preset set to: ${preset}`, "info");
        return;
      }

      // Show available presets
      const presetList = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${presetList}`, "info");
    },
  });

  function buildSegmentContext(ctx: any, width: number, theme: Theme): SegmentContext {
    const presetDef = getPreset(config.preset);
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    // Build usage stats and get thinking level from session
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    let lastAssistant: AssistantMessage | undefined;
    let thinkingLevelFromSession = "off";
    
    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    for (const e of sessionEvents) {
      // Check for thinking level change entries
      if (e.type === "thinking_level_change" && e.thinkingLevel) {
        thinkingLevelFromSession = e.thinkingLevel;
      }
      if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message as AssistantMessage;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          continue;
        }
        input += m.usage.input;
        output += m.usage.output;
        cacheRead += m.usage.cacheRead;
        cacheWrite += m.usage.cacheWrite;
        cost += m.usage.cost.total;
        lastAssistant = m;
      }
    }

    // Calculate context percentage (total tokens used in last turn)
    const contextTokens = lastAssistant
      ? lastAssistant.usage.input + lastAssistant.usage.output +
        lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
      : 0;
    const contextWindow = ctx.model?.contextWindow || 0;
    const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    return {
      model: ctx.model,
      thinkingLevel: thinkingLevelFromSession || getThinkingLevelFn?.() || "off",
      sessionId: ctx.sessionManager?.getSessionId?.(),
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      usingSubscription,
      sessionStartTime,
      git: gitStatus,
      extensionStatuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
      options: presetDef.segmentOptions ?? {},
      width,
      theme,
      colors,
    };
  }

  /**
   * Get cached responsive layout or compute fresh one.
   * Layout is cached per render cycle (same width = same layout).
   */
  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    // Cache is valid if same width and within 50ms (same render cycle)
    if (lastLayoutResult && lastLayoutWidth === width && now - lastLayoutTimestamp < 50) {
      return lastLayoutResult;
    }
    
    const presetDef = getPreset(config.preset);
    const segmentCtx = buildSegmentContext(currentCtx, width, theme);
    // Available width for top bar content (minus box corners: ╭─ and ─╮ = 4 chars)
    const topBarAvailable = width - 4;
    
    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, topBarAvailable);
    lastLayoutTimestamp = now;
    
    return lastLayoutResult;
  }

  function setupCustomEditor(ctx: any) {
    // Import CustomEditor dynamically and create wrapper
    import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
      ctx.ui.setEditorComponent((tui: any, editorTheme: any, keybindings: any) => {
        // Create custom editor that overrides render for status in top border
        const editor = new CustomEditor(tui, editorTheme, keybindings);
        
        // Override handleInput to dismiss welcome on first keypress
        const originalHandleInput = editor.handleInput.bind(editor);
        editor.handleInput = (data: string) => {
          // Dismiss welcome overlay/header on first keypress (use setTimeout to avoid re-entrancy)
          setTimeout(() => dismissWelcome(ctx), 0);
          originalHandleInput(data);
        };
        
        // Store original render
        const originalRender = editor.render.bind(editor);
        
        // Override render to match oh-my-pi design with rounded box:
        // ╭─ status content ────────────────────╮
        // │  input text here                   │
        // ╰─                                  ─╯
        // + autocomplete items (if showing)
        editor.render = (width: number): string[] => {
          // Minimum width for box layout: borders (4) + minimal content (1) = 5
          // Fall back to original render on extremely narrow terminals
          if (width < 10) {
            return originalRender(width);
          }
          
          const bc = (s: string) => `${getFgAnsiCode("border")}${s}${ansi.reset}`;
          
          // Box drawing chars
          const topLeft = bc("╭─");
          const topRight = bc("─╮");
          const bottomLeft = bc("╰─");
          const bottomRight = bc("─╯");
          const vertical = bc("│");
          
          // Content area is width - 6 (3 chars border on each side)
          const contentWidth = Math.max(1, width - 6);
          const lines = originalRender(contentWidth);
          
          if (lines.length === 0 || !currentCtx) return lines;
          
          // Find where the bottom border is (last line that's all ─ chars)
          // Lines after it are autocomplete items
          let bottomBorderIndex = lines.length - 1;
          for (let i = lines.length - 1; i >= 1; i--) {
            const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
            if (stripped.length > 0 && /^─+$/.test(stripped)) {
              bottomBorderIndex = i;
              break;
            }
          }
          
          const result: string[] = [];
          
          // Top border: ╭─ status ────────────╮
          // Use responsive layout - overflow goes to secondary row
          // Note: ctx.ui.theme is the pi Theme with fg(), editorTheme is the pi-tui EditorTheme for styling
          const layout = getResponsiveLayout(width, ctx.ui.theme);
          const statusContent = layout.topContent;
          const statusWidth = visibleWidth(statusContent);
          const topFillWidth = width - 4; // Reserve 4 for corners (╭─ and ─╮)
          
          const fillWidth = Math.max(0, topFillWidth - statusWidth);
          result.push(topLeft + statusContent + bc("─".repeat(fillWidth)) + topRight);
          
          // Content lines (between top border at 0 and bottom border)
          for (let i = 1; i < bottomBorderIndex; i++) {
            const line = lines[i] || "";
            const lineWidth = visibleWidth(line);
            const padding = " ".repeat(Math.max(0, contentWidth - lineWidth));
            
            const isLastContent = i === bottomBorderIndex - 1;
            if (isLastContent) {
              // Last content line: ╰─ content ─╯
              result.push(`${bottomLeft} ${line}${padding} ${bottomRight}`);
            } else {
              // Middle lines: │  content  │
              result.push(`${vertical}  ${line}${padding}  ${vertical}`);
            }
          }
          
          // If only had top/bottom borders (empty editor), add the bottom
          if (bottomBorderIndex === 1) {
            const padding = " ".repeat(contentWidth);
            result.push(`${bottomLeft} ${padding} ${bottomRight}`);
          }
          
          // Append any autocomplete lines that come after the bottom border
          for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
            result.push(lines[i] || "");
          }
          
          return result;
        };
        
        return editor;
      });

      // Set up footer data provider access via a minimal footer
      ctx.ui.setFooter((tui: any, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
        footerDataRef = footerData;
        tuiRef = tui; // Store TUI reference for re-renders on git branch changes
        const unsub = footerData.onBranchChange(() => tui.requestRender());

        return {
          dispose: unsub,
          invalidate() {
            // No cache to clear - render is always fresh
          },
          render(width: number): string[] {
            if (!currentCtx) return [];
            
            const presetDef = getPreset(config.preset);
            const segmentCtx = buildSegmentContext(currentCtx, width, theme);
            const lines: string[] = [];
            
            // During streaming, show primary status in footer (editor hidden)
            if (isStreaming) {
              const statusContent = buildStatusContent(segmentCtx, presetDef);
              if (statusContent) {
                const statusWidth = visibleWidth(statusContent);
                if (statusWidth <= width) {
                  lines.push(statusContent + " ".repeat(width - statusWidth));
                } else {
                  // Truncate by removing segments until it fits
                  // Start from leftSegments.length to try "just leftSegments" when rightSegments exists
                  let truncatedContent = "";
                  let foundFit = false;
                  for (let numSegments = presetDef.leftSegments.length; numSegments >= 1; numSegments--) {
                    const limitedPreset = {
                      ...presetDef,
                      leftSegments: presetDef.leftSegments.slice(0, numSegments),
                      rightSegments: [],
                    };
                    truncatedContent = buildStatusContent(segmentCtx, limitedPreset);
                    const truncWidth = visibleWidth(truncatedContent);
                    if (truncWidth <= width - 1) {
                      truncatedContent += "…";
                      foundFit = true;
                      break;
                    }
                  }
                  // Only push if we found a fit, otherwise skip (don't crash on very narrow terminals)
                  if (foundFit) {
                    lines.push(truncatedContent);
                  }
                }
              }
            }
            
            return lines;
          },
        };
      });

      // Set up secondary row as a widget below editor (above sub bar)
      // Shows overflow segments when top bar is too narrow
      ctx.ui.setWidget("powerline-secondary", (tui: any, theme: Theme) => {
        return {
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!currentCtx) return [];
            
            // Use responsive layout - secondary row shows overflow from top bar
            const layout = getResponsiveLayout(width, theme);
            
            // Only show secondary row if there's overflow content that fits
            if (layout.secondaryContent) {
              const contentWidth = visibleWidth(layout.secondaryContent);
              // Don't render if content exceeds terminal width (graceful degradation)
              if (contentWidth <= width) {
                return [layout.secondaryContent];
              }
            }
            
            return [];
          },
        };
      }, { placement: "belowEditor" });
    });
  }

  function setupWelcomeHeader(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    
    const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);
    welcomeHeaderActive = true; // Will be cleared on first user input
    
    ctx.ui.setHeader((_tui: any, _theme: any) => {
      return {
        render(width: number): string[] {
          return header.render(width);
        },
        invalidate() {
          header.invalidate();
        },
      };
    });
  }

  function setupWelcomeOverlay(ctx: any) {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const loadedCounts = discoverLoadedCounts();
    const recentSessions = getRecentSessions(3);
    
    // Small delay to let pi-mono finish initialization
    setTimeout(() => {
      // Skip overlay if:
      // 1. Dismissal was explicitly requested (stream_start/user_message fired)
      // 2. Agent is already streaming
      // 3. Session already has assistant messages (agent already responded)
      if (welcomeOverlayShouldDismiss || isStreaming) {
        welcomeOverlayShouldDismiss = false;
        return;
      }
      
      // Check if session already has activity (handles p "command" case)
      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((e: any) => 
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" ||
        e.type === "tool_result"
      );
      if (hasActivity) {
        return;
      }
      
      ctx.ui.custom(
        (tui: any, _theme: any, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(
            modelName,
            providerName,
            recentSessions,
            loadedCounts,
          );
          
          let countdown = 30;
          let dismissed = false;
          
          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };
          
          // Store dismiss callback so user_message/keypress can trigger it
          dismissWelcomeOverlay = dismiss;
          
          // Double-check: dismissal might have been requested between the outer check
          // and this callback running
          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }
          
          const interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);
          
          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: (_data: string) => dismiss(),
            dispose: () => {
              dismissed = true;
              clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
          }),
        },
      ).catch(() => {});
    }, 100);
  }
}
