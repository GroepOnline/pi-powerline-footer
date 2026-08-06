import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { StatusLineSegment } from "../config/types.ts";
import { normalizeCompactExtensionStatus } from "../config/powerline-config.ts";
import { getIcons, SEP_DOT } from "../theme/icons.ts";
import { color, withIcon } from "./shared.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

export const thinkingSegment: StatusLineSegment = {
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

export const subagentsSegment: StatusLineSegment = {
  id: "subagents",
  render() {
    // Note: pi-mono doesn't have subagent tracking built-in
    // This would require extension state management
    // For now, return not visible
    return { content: "", visible: false };
  },
};

export const queueSegment: StatusLineSegment = {
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

export const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0)
      return { content: "", visible: false };

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
  if (out === null)
    out = run(
      includeUdp ? "netstat -tuln 2>/dev/null" : "netstat -tln 2>/dev/null",
    );
  if (out === null) return readProcListeningPorts(includeUdp);

  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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

export const tpsSegment: StatusLineSegment = {
  id: "tps",
  render(ctx) {
    const override = process.env.POWERLINE_TPS?.trim();
    if (override) {
      return {
        content: withIcon(getIcons().tps, color(ctx, "tokens", override)),
        visible: true,
      };
    }
    const out = ctx.usageStats?.output ?? 0;
    const now = Date.now();
    tpsSamples.push({ at: now, output: out });
    // keep the last 5s of samples; drop everything older (idle gaps get forgotten)
    while (tpsSamples.length > 0 && now - tpsSamples[0].at > 5000)
      tpsSamples.shift();
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
      content: withIcon(
        getIcons().tps,
        color(ctx, tps > 0 ? "tokens" : "queue", text),
      ),
      visible: true,
    };
  },
};

export const openPortsSegment: StatusLineSegment = {
  id: "open_ports",
  render(ctx) {
    const includeUdp = ctx.options?.openPorts?.includeUdp === true;
    const count = countListeningPorts(includeUdp);
    const label = ctx.segmentLabels?.get("open_ports");
    const text = label ? `${label} ${count}` : String(count);
    return {
      content: withIcon(getIcons().ports, color(ctx, "queue", text)),
      visible: true,
    };
  },
};
