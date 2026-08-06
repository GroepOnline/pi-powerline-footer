import type {
  BuiltinStatusLineSegmentId,
  RenderedSegment,
  SegmentContext,
  StatusLineSegment,
  StatusLineSegmentId,
} from "../config/types.ts";
import {
  modelSegment,
  shellModeSegment,
  pathSegment,
  gitSegment,
  timeSpentSegment,
  timeSegment,
  sessionSegment,
  hostnameSegment,
} from "./core.ts";
import {
  tokenInSegment,
  tokenOutSegment,
  tokenTotalSegment,
  costSegment,
  contextPctSegment,
  contextTotalSegment,
  cacheReadSegment,
  cacheWriteSegment,
} from "./usage.ts";
import {
  thinkingSegment,
  subagentsSegment,
  queueSegment,
  extensionStatusesSegment,
  tpsSegment,
  openPortsSegment,
} from "./system.ts";
import {
  customComputedSegments,
  renderCustomSegment,
  isCustomSegmentId,
} from "./custom.ts";

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

export function renderSegment(
  id: StatusLineSegmentId,
  ctx: SegmentContext,
): RenderedSegment {
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
