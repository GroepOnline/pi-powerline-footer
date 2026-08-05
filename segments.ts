import { hostname as osHostname } from "node:os";
import { basename } from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { BuiltinStatusLineSegmentId, CustomSegmentConfig, RenderedSegment, SegmentContext, SemanticColor, StatusLineSegment, StatusLineSegmentId } from "./types.ts";
import { normalizeCompactExtensionStatus, normalizeExtensionStatusValue } from "./powerline-config.ts";
import { fg, applyColor } from "./theme.ts";
import { getIcons, SEP_DOT, getThinkingText } from "./icons.ts";
import { formatUsdCost } from "./currency-rates.ts";
import { getGitRemoteHost } from "./git-status.ts";
import type { IconSet } from "./icons.ts";
import type { GitHost } from "./git-status.ts";

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

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

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};

    let modelName = ctx.model?.name || ctx.model?.id || "no-model";
    if (opts.display === "qualified" && ctx.model?.id) {
      const provider = ctx.model.provider || ctx.model.providerId || ctx.model.providerName;
      modelName = provider && !ctx.model.id.includes("/") ? `${provider}/${ctx.model.id}` : ctx.model.id;
    } else if (modelName.startsWith("Claude ")) {
      modelName = modelName.slice(7);
    }

    let content = withIcon(icons.model, modelName);

    if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
      const level = ctx.thinkingLevel || "off";
      if (level !== "off") {
        const thinkingText = getThinkingText(level);
        if (thinkingText) {
          content += `${SEP_DOT}${thinkingText}`;
        }
      }
    }

    return { content: color(ctx, "model", content), visible: true };
  },
};

const shellModeSegment: StatusLineSegment = {
  id: "shell_mode",
  render(ctx) {
    if (!ctx.shellModeActive) {
      return { content: "", visible: false };
    }

    const shellName = ctx.shellName ?? "shell";
    const state = ctx.shellRunning ? "run" : "idle";
    const cwd = ctx.shellCwd ? basename(ctx.shellCwd) : null;
    const parts = [shellName, state];
    if (cwd) {
      parts.push(cwd);
    }

    return { content: color(ctx, "shellMode", parts.join(SEP_DOT)), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.path ?? {};
    const mode = opts.mode ?? "basename";

    let pwd = ctx.shellModeActive && ctx.shellCwd ? ctx.shellCwd : (ctx.cwd ?? process.cwd());
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
    return { content: color(ctx, "path", content), visible: true };
  },
};

/**
 * Icon for the branch label: the origin remote's host logo when hostIcon is
 * enabled and a remote is known, otherwise the plain branch icon. An
 * unrecognized remote falls back to the generic git logo.
 */
function resolveBranchIcon(icons: IconSet, hostIcon: boolean): string {
  if (!hostIcon) return icons.branch;
  const host = getGitRemoteHost();
  const byHost: Record<GitHost, string> = {
    github: icons.github,
    gitlab: icons.gitlab,
    bitbucket: icons.bitbucket,
    other: icons.git,
  };
  return host ? byHost[host] : icons.branch;
}

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
    const branchColor: SemanticColor = isDirty ? "gitDirty" : "gitClean";

    // Build content - color branch separately from indicators
    let content = "";
    if (showBranch && branch) {
      // Color just the branch name (icon + branch text)
      const branchIcon = resolveBranchIcon(icons, opts.hostIcon === true);
      content = color(ctx, branchColor, withIcon(branchIcon, branch));
    }

    // Add status indicators (each with their own color, not wrapped)
    if (gitStatus) {
      const indicators: string[] = [];
      if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
        indicators.push(applyColor(ctx.theme, "warning", `*${gitStatus.unstaged}`));
      }
      if (opts.showStaged !== false && gitStatus.staged > 0) {
        indicators.push(applyColor(ctx.theme, "success", `+${gitStatus.staged}`));
      }
      if (opts.showUntracked !== false && gitStatus.untracked > 0) {
        indicators.push(applyColor(ctx.theme, "muted", `?${gitStatus.untracked}`));
      }
      if (indicators.length > 0) {
        const indicatorText = indicators.join(" ");
        if (!content && showBranch === false) {
          // No branch shown, color the git icon with branch color
          content = color(ctx, branchColor, icons.git ? `${icons.git} ` : "") + indicatorText;
        } else {
          content += content ? ` ${indicatorText}` : indicatorText;
        }
      }
    }

    if (!content) return { content: "", visible: false };

    return { content, visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";

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

    if (level === "high" || level === "xhigh" || level === "max") {
      return { content: color(ctx, "thinking", content), visible: true };
    }

    if (level === "minimal") {
      return { content: color(ctx, "thinkingMinimal", content), visible: true };
    }
    if (level === "low") {
      return { content: color(ctx, "thinkingLow", content), visible: true };
    }
    if (level === "medium") {
      return { content: color(ctx, "thinkingMedium", content), visible: true };
    }

    return { content: color(ctx, "thinking", content), visible: true };
  },
};

const subagentsSegment: StatusLineSegment = {
  id: "subagents",
  render() {
    // Note: pi-mono doesn't have subagent tracking built-in
    // This would require extension state management
    // For now, return not visible
    return { content: "", visible: false };
  },
};

const queueSegment: StatusLineSegment = {
  id: "queue",
  render(ctx) {
    const summary = ctx.queueSummary;
    const parts: string[] = [];

    if (summary.compacting && summary.queueCount > 0) {
      parts.push(`compact q ${summary.queueCount}`);
    } else if (summary.queueCount > 0) {
      parts.push(`q ${summary.queueCount}`);
    }

    if (summary.ideaCount > 0) {
      parts.push(`ideas ${summary.ideaCount}`);
    }

    if (summary.blockedCount > 0) {
      parts.push(`blocked ${summary.blockedCount}`);
    }

    if (parts.length === 0) return { content: "", visible: false };
    return { content: color(ctx, "queue", parts.join(SEP_DOT)), visible: true };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };

    const content = withIcon(icons.input, formatTokens(input));
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };

    const content = withIcon(icons.output, formatTokens(output));
    return { content: color(ctx, "tokens", content), visible: true };
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
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const cost = ctx.usageStats.cost + (ctx.usageStats.subagentCost ?? 0);
    const usingSubscription = ctx.usingSubscription;

    if (!cost && !usingSubscription) {
      return { content: "", visible: false };
    }

    const reportedCost = cost > 0 ? formatUsdCost(cost, ctx.options.cost?.currency) : null;
    if (!usingSubscription) {
      return reportedCost
        ? { content: color(ctx, "cost", reportedCost), visible: true }
        : { content: "", visible: false };
    }

    const subscriptionDisplay = ctx.options.cost?.subscriptionDisplay ?? "subscription";
    if (subscriptionDisplay === "reported-cost" && reportedCost) {
      return { content: color(ctx, "cost", reportedCost), visible: true };
    }
    if (subscriptionDisplay === "both" && reportedCost) {
      return { content: color(ctx, "cost", `${reportedCost} (sub)`), visible: true };
    }

    return { content: color(ctx, "cost", "(sub)"), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const { contextTokens, contextPercent, contextWindow } = ctx;
    if (!contextWindow || !Number.isFinite(contextPercent)) {
      return { content: "", visible: false };
    }

    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";
    const percentOnly = ctx.options.context?.format === "percent";
    // "full" (default): tokens/window + one-decimal percentage + auto-compact icon.
    // "percent": bare rounded percentage, threshold-colored, no icons.
    const text = percentOnly
      ? `${Math.round(contextPercent)}%`
      : `${formatTokens(contextTokens)}/${formatTokens(contextWindow)} (${contextPercent.toFixed(1)}%)${autoIcon}`;

    // Icon outside color, text inside - use semantic colors for thresholds
    let content: string;
    const colored = (semantic: "context" | "contextWarn" | "contextError") =>
      percentOnly ? color(ctx, semantic, text) : withIcon(icons.context, color(ctx, semantic, text));
    if (contextPercent > 90) {
      content = colored("contextError");
    } else if (contextPercent > 70) {
      content = colored("contextWarn");
    } else {
      content = colored("context");
    }

    return { content, visible: true };
  },
};

const contextTotalSegment: StatusLineSegment = {
  id: "context_total",
  render(ctx) {
    if (ctx.customCompactionEnabled) return { content: "", visible: false };

    const icons = getIcons();
    const window = ctx.contextWindow;
    if (!window) return { content: "", visible: false };

    return {
      content: color(ctx, "context", withIcon(icons.context, formatTokens(window))),
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

    return { content: withIcon(icons.time, timeStr), visible: true };
  },
};

const sessionSegment: StatusLineSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    const sessionId = ctx.sessionId;
    const display = sessionId?.slice(0, 8) || "new";

    return { content: withIcon(icons.session, display), visible: true };
  },
};

const hostnameSegment: StatusLineSegment = {
  id: "hostname",
  render() {
    const icons = getIcons();
    const name = osHostname().split(".")[0];
    return { content: withIcon(icons.host, name), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    const { cacheRead, input } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };

    const format = ctx.options.cache_read?.format ?? "tokens";
    const hitRate = input + cacheRead > 0
      ? ((cacheRead / (input + cacheRead)) * 100).toFixed(0)
      : "0";

    let content: string;
    if (format === "percent") {
      content = [icons.cache, `${hitRate}%`].filter(Boolean).join(" ");
    } else {
      const tokens = [icons.cache, icons.input, formatTokens(cacheRead)].filter(Boolean).join(" ");
      content = format === "both" ? `${tokens} (${hitRate}%)` : tokens;
    }
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };

    const parts = [icons.cache, icons.output, formatTokens(cacheWrite)].filter(Boolean);
    const content = parts.join(" ");
    return { content: color(ctx, "tokens", content), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0) return { content: "", visible: false };

    // Join compact statuses with a separator
    // Skip: empty strings, notification-style ("[...") shown above editor,
    // and strings that are only ANSI codes with no visible text.
    // Also skip statuses explicitly elevated into dedicated custom segments.
    const parts: string[] = [];
    for (const [statusKey, value] of statuses.entries()) {
      if (ctx.hiddenExtensionStatusKeys.has(statusKey)) continue;
      const normalized = value ? normalizeCompactExtensionStatus(value) : null;
      if (normalized) {
        parts.push(normalized);
      }
    }

    if (parts.length === 0) return { content: "", visible: false };

    // Statuses already have their own styling applied by the extensions
    const content = parts.join(` ${SEP_DOT} `);
    return { content, visible: true };
  },
};

export function countListeningPorts(includeUdp = false): number {
  // ponytail: count UNIQUE TCP listening ports (dedupes IPv4/IPv6 dual-stack and
  // repeated multicast binds). UDP is noisy (mDNS/DHCP/ephemeral) so it's opt-in.
  const run = (cmd: string): string | null => {
    try {
      return execSync(cmd, { encoding: "utf8" });
    } catch {
      return null;
    }
  };
  const proto = includeUdp ? "-tulnH" : "-tlnH";
  let out = run(`ss ${proto} 2>/dev/null`);
  if (out === null) out = run(`ss ${proto.replace("H", "")} 2>/dev/null`);
  if (out === null) out = run(includeUdp ? "netstat -tuln 2>/dev/null" : "netstat -tln 2>/dev/null");
  if (out === null) return readProcListeningPorts(includeUdp);

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = /^(Proto|Netid|State|Local)/.test(lines[0] ?? "") ? 1 : 0;
  const ports = new Set<number>();
  for (const line of lines.slice(start)) {
    // ss/netstat put the local address at different columns; take the first addr:port token
    for (const col of line.split(/\s+/)) {
      const m = /:(\d+)$/.exec(col);
      if (m) {
        ports.add(Number(m[1]));
        break;
      }
    }
  }
  return ports.size;
}

function readProcListeningPorts(includeUdp: boolean): number {
  // ponytail: last-resort /proc parse when ss/netstat are unavailable; dedupe by port
  const files = includeUdp ? ["tcp", "tcp6", "udp", "udp6"] : ["tcp", "tcp6"];
  const ports = new Set<number>();
  for (const f of files) {
    try {
      const data = readFileSync(`/proc/net/${f}`, "utf8");
      for (const line of data.split("\n")) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        if (f.startsWith("tcp") && cols[3] !== "0A") continue; // LISTEN state
        const m = /:([0-9A-Fa-f]{1,4})$/.exec(cols[1]);
        if (m) ports.add(parseInt(m[1], 16));
      }
    } catch {
      // file may not exist; skip
    }
  }
  return ports.size;
}

// Rolling 1-second sliding window of (timestamp, cumulative output) samples.
// Renders fire every ~33ms during streaming, so a per-render delta spikes (tiny dt);
// a fixed ~1s lookback gives a stable, honest tokens/sec over the last second.
const tpsSamples: { at: number; output: number }[] = [];

const tpsSegment: StatusLineSegment = {
  id: "tps",
  render(ctx) {
    const override = process.env.POWERLINE_TPS?.trim();
    if (override) {
      return { content: withIcon(getIcons().tps, color(ctx, "tokens", override)), visible: true };
    }
    const out = ctx.usageStats?.output ?? 0;
    const now = Date.now();
    tpsSamples.push({ at: now, output: out });
    // keep the last 5s of samples; drop everything older (idle gaps get forgotten)
    while (tpsSamples.length > 0 && now - tpsSamples[0].at > 5000) tpsSamples.shift();
    if (tpsSamples.length > 240) tpsSamples.splice(0, tpsSamples.length - 240);

    // pick the sample closest to 1s old (window [0.5s, 2s]) for a stable rate
    let ref: { at: number; output: number } | null = null;
    let bestDelta = Infinity;
    for (const s of tpsSamples) {
      const age = now - s.at;
      if (age < 500) continue;
      const d = Math.abs(age - 1000);
      if (d < bestDelta) {
        bestDelta = d;
        ref = s;
      }
    }
    let tps = 0;
    if (ref) {
      const dt = (now - ref.at) / 1000;
      const dOut = out - ref.output;
      if (dt > 0 && dOut >= 0) tps = dOut / dt;
    }
    const valueText = tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
    const label = ctx.segmentLabels?.get("tps");
    const text = label ? `${label} ${valueText}` : valueText;
    // levendig: light up in the tokens color while generating, dim while idle
    return {
      content: withIcon(getIcons().tps, color(ctx, tps > 0 ? "tokens" : "queue", text)),
      visible: true,
    };
  },
};

const openPortsSegment: StatusLineSegment = {
  id: "open_ports",
  render(ctx) {
    const includeUdp = ctx.options?.openPorts?.includeUdp === true;
    const count = countListeningPorts(includeUdp);
    const label = ctx.segmentLabels?.get("open_ports");
    const text = label ? `${label} ${count}` : String(count);
    return { content: withIcon(getIcons().ports, color(ctx, "queue", text)), visible: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<BuiltinStatusLineSegmentId, StatusLineSegment> = {
  model: modelSegment,
  shell_mode: shellModeSegment,
  path: pathSegment,
  git: gitSegment,
  thinking: thinkingSegment,
  subagents: subagentsSegment,
  queue: queueSegment,
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
  tps: tpsSegment,
  open_ports: openPortsSegment,
  extension_statuses: extensionStatusesSegment,
};

// User-defined computed segments (command/env/static), registered at config time.
const customComputedSegments = new Map<string, StatusLineSegment>();
const commandCache = new Map<string, { at: number; value: string }>();

function runCommandCached(command: string, cacheMs: number | undefined): string | null {
  // ponytail: simple in-memory cache keyed by command; avoids re-spawning shells every paint
  const now = Date.now();
  const cached = commandCache.get(command);
  if (cached && cacheMs !== undefined && now - cached.at < cacheMs) return cached.value;
  try {
    const out = execSync(command, { encoding: "utf8" }).trim();
    if (cacheMs !== undefined) commandCache.set(command, { at: now, value: out });
    return out;
  } catch {
    return null;
  }
}

function makeComputedSegment(id: string, def: CustomSegmentConfig): StatusLineSegment {
  return {
    id: `custom:${id}` as StatusLineSegmentId,
    render(ctx: SegmentContext): RenderedSegment {
      let text = "";
      if (def.type === "command") {
        const out = runCommandCached(def.command, def.cacheMs);
        if (out === null) return { content: "", visible: false };
        text = out;
      } else if (def.type === "env") {
        const val = process.env[def.env];
        if (!val) {
          if (def.fallback === undefined) return { content: "", visible: false };
          text = def.fallback;
        } else {
          text = val;
        }
      } else {
        text = def.text;
      }

      if (!text) return { content: "", visible: false };

      let content = text;
      if (def.prefix) content = `${def.prefix}${SEP_DOT}${content}`;
      if (def.color) content = applyColor(ctx.theme, def.color, content);
      return { content, visible: true };
    },
  };
}

/** Register user-defined computed segments from settings. Replaces any previously registered. */
export function registerCustomSegments(defs: Record<string, CustomSegmentConfig>): void {
  customComputedSegments.clear();
  for (const [id, def] of Object.entries(defs)) {
    customComputedSegments.set(id, makeComputedSegment(id, def));
  }
}

function renderCustomSegment(id: `custom:${string}`, ctx: SegmentContext): RenderedSegment {
  const customItemId = id.slice("custom:".length);
  const custom = ctx.customItemsById.get(customItemId);
  if (!custom) return { content: "", visible: false };

  const rawStatus = ctx.extensionStatuses.get(custom.statusKey);
  const normalizedStatus = rawStatus ? normalizeExtensionStatusValue(rawStatus) : null;
  if (!normalizedStatus) {
    return custom.hideWhenMissing ? { content: "", visible: false } : { content: custom.prefix ?? custom.id, visible: true };
  }

  let content = normalizedStatus;
  if (custom.prefix) {
    content = `${custom.prefix}${SEP_DOT}${content}`;
  }
  if (custom.color) {
    content = applyColor(ctx.theme, custom.color, content);
  }

  return { content, visible: true };
}

function isCustomSegmentId(id: StatusLineSegmentId): id is `custom:${string}` {
  return id.startsWith("custom:");
}

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  if (isCustomSegmentId(id)) {
    const customId = id.slice("custom:".length);
    const computed = customComputedSegments.get(customId);
    if (computed) return computed.render(ctx);
    return renderCustomSegment(id, ctx);
  }

  const segment = SEGMENTS[id];
  if (!segment) {
    return { content: "", visible: false };
  }
  return segment.render(ctx);
}
