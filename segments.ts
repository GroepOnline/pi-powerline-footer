import { hostname as osHostname } from "node:os";
import { basename } from "node:path";
import type { RenderedSegment, SegmentContext, StatusLineSegment, StatusLineSegmentId } from "./types.js";
import { fgOnly, rainbow } from "./colors.js";
import { getIcons, SEP_DOT, getThinkingText } from "./icons.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

const piSegment: StatusLineSegment = {
  id: "pi",
  render(_ctx) {
    const icons = getIcons();
    if (!icons.pi) return { content: "", visible: false };
    const content = `${icons.pi} `;
    return { content: fgOnly("accent", content), visible: true };
  },
};

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};

    let modelName = ctx.model?.name || ctx.model?.id || "no-model";
    // Strip "Claude " prefix for brevity
    if (modelName.startsWith("Claude ")) {
      modelName = modelName.slice(7);
    }

    let content = withIcon(icons.model, modelName);

    // Add thinking level with dot separator
    if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      if (level !== "off") {
        const thinkingText = getThinkingText(level);
        if (thinkingText) {
          content += `${SEP_DOT}${thinkingText}`;
        }
      }
    }

    return { content: fgOnly("model", content), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.path ?? {};
    const mode = opts.mode ?? "basename";

    let pwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE;

    if (mode === "basename") {
      // Just the last directory component (cross-platform)
      pwd = basename(pwd) || pwd;
    } else {
      // Abbreviate home directory for abbreviated/full modes
      if (home && pwd.startsWith(home)) {
        pwd = `~${pwd.slice(home.length)}`;
      }

      // Strip /work/ prefix (common in containers)
      if (pwd.startsWith("/work/")) {
        pwd = pwd.slice(6);
      }

      // Truncate if too long (only for abbreviated mode)
      if (mode === "abbreviated") {
        const maxLen = opts.maxLength ?? 40;
        if (pwd.length > maxLen) {
          pwd = `…${pwd.slice(-(maxLen - 1))}`;
        }
      }
    }

    const content = withIcon(icons.folder, pwd);
    return { content: fgOnly("path", content), visible: true };
  },
};

const gitSegment: StatusLineSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const gitStatus = (staged > 0 || unstaged > 0 || untracked > 0) 
      ? { staged, unstaged, untracked } 
      : null;

    if (!branch && !gitStatus) return { content: "", visible: false };

    const isDirty = gitStatus && (gitStatus.staged > 0 || gitStatus.unstaged > 0 || gitStatus.untracked > 0);
    const showBranch = opts.showBranch !== false;

    // Build content
    let content = "";
    if (showBranch && branch) {
      content = withIcon(icons.branch, branch);
    }

    // Add status indicators
    if (gitStatus) {
      const indicators: string[] = [];
      if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
        indicators.push(fgOnly("unstaged", `*${gitStatus.unstaged}`));
      }
      if (opts.showStaged !== false && gitStatus.staged > 0) {
        indicators.push(fgOnly("staged", `+${gitStatus.staged}`));
      }
      if (opts.showUntracked !== false && gitStatus.untracked > 0) {
        indicators.push(fgOnly("untracked", `?${gitStatus.untracked}`));
      }
      if (indicators.length > 0) {
        const indicatorText = indicators.join(" ");
        if (!content && showBranch === false) {
          content = withIcon(icons.git, indicatorText);
        } else {
          content += content ? ` ${indicatorText}` : indicatorText;
        }
      }
    }

    if (!content) return { content: "", visible: false };

    // Wrap entire content in branch color
    const colorName = isDirty ? "gitDirty" : "gitClean";
    return { content: fgOnly(colorName, content), visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";

    // Text label for each level
    const levelText: Record<string, string> = {
      off: "off",
      minimal: "min",
      low: "low",
      medium: "med",
      high: "high",
      xhigh: "xhigh",
    };
    const label = levelText[level] || level;
    const content = `think:${label}`;

    // Use rainbow effect for high/xhigh (like Claude Code ultrathink)
    if (level === "high" || level === "xhigh") {
      return { content: rainbow(content), visible: true };
    }

    // Use dedicated thinking colors (gradient: gray → purple → blue → teal)
    const colorMap: Record<string, "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium"> = {
      off: "thinkingOff",
      minimal: "thinkingMinimal",
      low: "thinkingLow",
      medium: "thinkingMedium",
    };
    const color = colorMap[level] || "thinkingOff";
    
    return { content: fgOnly(color, content), visible: true };
  },
};

const subagentsSegment: StatusLineSegment = {
  id: "subagents",
  render(_ctx) {
    // Note: pi-mono doesn't have subagent tracking built-in
    // This would require extension state management
    // For now, return not visible
    return { content: "", visible: false };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };

    const content = withIcon(icons.input, formatTokens(input));
    return { content: fgOnly("spend", content), visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };

    const content = withIcon(icons.output, formatTokens(output));
    return { content: fgOnly("output", content), visible: true };
  },
};

const tokenTotalSegment: StatusLineSegment = {
  id: "token_total",
  render(ctx) {
    const icons = getIcons();
    const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
    const total = input + output + cacheRead + cacheWrite;
    if (!total) return { content: "", visible: false };

    const content = withIcon(icons.tokens, formatTokens(total));
    return { content: fgOnly("spend", content), visible: true };
  },
};

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const { cost } = ctx.usageStats;
    const usingSubscription = ctx.usingSubscription;

    if (!cost && !usingSubscription) {
      return { content: "", visible: false };
    }

    const costDisplay = usingSubscription ? "(sub)" : `$${cost.toFixed(2)}`;
    return { content: fgOnly("cost", costDisplay), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    const icons = getIcons();
    const pct = ctx.contextPercent;
    const window = ctx.contextWindow;

    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";
    const text = `${pct.toFixed(1)}%/${formatTokens(window)}${autoIcon}`;

    // Icon outside color, text inside
    let content: string;
    if (pct > 90) {
      content = withIcon(icons.context, fgOnly("error", text));
    } else if (pct > 70) {
      content = withIcon(icons.context, fgOnly("warning", text));
    } else {
      content = withIcon(icons.context, fgOnly("context", text));
    }

    return { content, visible: true };
  },
};

const contextTotalSegment: StatusLineSegment = {
  id: "context_total",
  render(ctx) {
    const icons = getIcons();
    const window = ctx.contextWindow;
    if (!window) return { content: "", visible: false };

    return {
      content: fgOnly("context", withIcon(icons.context, formatTokens(window))),
      visible: true,
    };
  },
};

const timeSpentSegment: StatusLineSegment = {
  id: "time_spent",
  render(ctx) {
    const icons = getIcons();
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) return { content: "", visible: false };

    // No explicit color
    return { content: withIcon(icons.time, formatDuration(elapsed)), visible: true };
  },
};

const timeSegment: StatusLineSegment = {
  id: "time",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.time ?? {};
    const now = new Date();

    let hours = now.getHours();
    let suffix = "";
    if (opts.format === "12h") {
      suffix = hours >= 12 ? "pm" : "am";
      hours = hours % 12 || 12;
    }

    const mins = now.getMinutes().toString().padStart(2, "0");
    let timeStr = `${hours}:${mins}`;
    if (opts.showSeconds) {
      timeStr += `:${now.getSeconds().toString().padStart(2, "0")}`;
    }
    timeStr += suffix;

    // No explicit color
    return { content: withIcon(icons.time, timeStr), visible: true };
  },
};

const sessionSegment: StatusLineSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    const sessionId = ctx.sessionId;
    const display = sessionId?.slice(0, 8) || "new";

    // No explicit color
    return { content: withIcon(icons.session, display), visible: true };
  },
};

const hostnameSegment: StatusLineSegment = {
  id: "hostname",
  render(_ctx) {
    const icons = getIcons();
    const name = osHostname().split(".")[0];
    // No explicit color
    return { content: withIcon(icons.host, name), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    const { cacheRead } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };

    // Space-separated parts
    const parts = [icons.cache, icons.input, formatTokens(cacheRead)].filter(Boolean);
    const content = parts.join(" ");
    return { content: fgOnly("spend", content), visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };

    // Space-separated parts
    const parts = [icons.cache, icons.output, formatTokens(cacheWrite)].filter(Boolean);
    const content = parts.join(" ");
    return { content: fgOnly("output", content), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0) return { content: "", visible: false };

    // Join all extension statuses with a separator
    const parts: string[] = [];
    for (const [_key, value] of statuses) {
      if (value) parts.push(value);
    }

    if (parts.length === 0) return { content: "", visible: false };

    // Statuses already have their own styling applied by the extensions
    const content = parts.join(` ${SEP_DOT} `);
    return { content, visible: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
  pi: piSegment,
  model: modelSegment,
  path: pathSegment,
  git: gitSegment,
  thinking: thinkingSegment,
  subagents: subagentsSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cost: costSegment,
  context_pct: contextPctSegment,
  context_total: contextTotalSegment,
  time_spent: timeSpentSegment,
  time: timeSegment,
  session: sessionSegment,
  hostname: hostnameSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  extension_statuses: extensionStatusesSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  const segment = SEGMENTS[id];
  if (!segment) {
    return { content: "", visible: false };
  }
  return segment.render(ctx);
}
