import type { ExtensionAPI, ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { visibleWidth } from "@mariozechner/pi-tui";

import type { SegmentContext, StatusLinePreset } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getSeparator } from "./separators.js";
import { renderSegment } from "./segments.js";
import { getGitStatus, invalidateGitStatus } from "./git-status.js";
import { ansi, getFgAnsiCode } from "./colors.js";

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

interface PowerlineConfig {
  preset: StatusLinePreset;
}

let config: PowerlineConfig = {
  preset: "default",
};

// ═══════════════════════════════════════════════════════════════════════════
// Status Line Builder (for top border)
// ═══════════════════════════════════════════════════════════════════════════

/** Build just the status content (segments with separators, no borders) */
function buildStatusContent(ctx: SegmentContext, presetDef: ReturnType<typeof getPreset>): string {
  const separatorDef = getSeparator(presetDef.separator);
  const sepAnsi = getFgAnsiCode("sep");

  // Collect visible segment contents
  const leftParts: string[] = [];
  for (const segId of presetDef.leftSegments) {
    const rendered = renderSegment(segId, ctx);
    if (rendered.visible && rendered.content) {
      leftParts.push(rendered.content);
    }
  }

  const rightParts: string[] = [];
  for (const segId of presetDef.rightSegments) {
    const rendered = renderSegment(segId, ctx);
    if (rendered.visible && rendered.content) {
      rightParts.push(rendered.content);
    }
  }

  if (leftParts.length === 0 && rightParts.length === 0) {
    return "";
  }

  // Build content with powerline separators (no background)
  const sep = separatorDef.left;
  const allParts = [...leftParts, ...rightParts];
  return " " + allParts.join(` ${sepAnsi}${sep}${ansi.reset} `) + " ";
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function powerlineFooter(pi: ExtensionAPI) {
  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let footerDispose: (() => void) | null = null;
  let getThinkingLevelFn: (() => string) | null = null;

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
    }
  });

  // Invalidate git status on file changes
  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
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
          ctx.ui.notify("Powerline status enabled", "info");
        } else {
          // Note: setFooter(undefined) internally calls the old footer's dispose()
          // so we don't need to call footerDispose ourselves
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          footerDispose = null;
          footerDataRef = null;
          ctx.ui.notify("Default editor restored", "info");
        }
        return;
      }

      // Check if args is a preset name
      const preset = args.trim().toLowerCase() as StatusLinePreset;
      if (preset in PRESETS) {
        config.preset = preset;
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

  function buildSegmentContext(ctx: any, width: number): SegmentContext {
    const presetDef = getPreset(config.preset);

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
    };
  }

  function setupCustomEditor(ctx: any) {
    // Import CustomEditor dynamically and create wrapper
    import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
      ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
        // Create custom editor that overrides render for status in top border
        const editor = new CustomEditor(theme, keybindings);
        
        // Store original render
        const originalRender = editor.render.bind(editor);
        
        // Override render to match oh-my-pi design with rounded box:
        // ╭─ status content ────────────────────╮
        // │  input text here                   │
        // ╰─                                  ─╯
        // + autocomplete items (if showing)
        editor.render = (width: number): string[] => {
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
          const presetDef = getPreset(config.preset);
          const segmentCtx = buildSegmentContext(currentCtx, width);
          const statusContent = buildStatusContent(segmentCtx, presetDef);
          const statusWidth = visibleWidth(statusContent);
          const topFillWidth = width - 4; // Reserve 4 for corners (╭─ and ─╮)
          
          if (statusWidth <= topFillWidth) {
            const fillWidth = topFillWidth - statusWidth;
            result.push(topLeft + statusContent + bc("─".repeat(fillWidth)) + topRight);
          } else {
            result.push(topLeft + bc("─".repeat(topFillWidth)) + topRight);
          }
          
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

      // Also set up footer data provider access via a minimal footer
      ctx.ui.setFooter((tui: any, _theme: any, footerData: ReadonlyFooterDataProvider) => {
        footerDataRef = footerData;
        const unsub = footerData.onBranchChange(() => tui.requestRender());

        // Track dispose for cleanup when disabling
        footerDispose = unsub;

        return {
          dispose: unsub,
          invalidate() {
            // Re-render when thinking level or other settings change
            tui.requestRender();
          },
          render(_width: number): string[] {
            // Return empty - we render in editor top border instead
            return [];
          },
        };
      });
    });
  }
}
