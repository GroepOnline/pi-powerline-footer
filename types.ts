// Segment identifiers
export type StatusLineSegmentId =
  | "pi"
  | "model"
  | "path"
  | "git"
  | "subagents"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cost"
  | "context_pct"
  | "context_total"
  | "time_spent"
  | "time"
  | "session"
  | "hostname"
  | "cache_read"
  | "cache_write"
  | "thinking"
  | "extension_statuses";

// Separator styles
export type StatusLineSeparatorStyle =
  | "powerline"
  | "powerline-thin"
  | "slash"
  | "pipe"
  | "block"
  | "none"
  | "ascii"
  | "dot"
  | "chevron"
  | "star";

// Preset names
export type StatusLinePreset =
  | "default"
  | "minimal"
  | "compact"
  | "full"
  | "nerd"
  | "ascii"
  | "custom";

// Per-segment options
export interface StatusLineSegmentOptions {
  model?: { showThinkingLevel?: boolean };
  path?: { 
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean };
  time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

// Preset definition
export interface PresetDef {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  /** Secondary row segments (shown in footer, above sub bar) */
  secondarySegments?: StatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
}

// Separator definition
export interface SeparatorDef {
  left: string;
  right: string;
  endCaps?: {
    left: string;
    right: string;
    useBgAsFg: boolean;
  };
}

// Git status data
export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

// Usage statistics
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// Context passed to segment render functions
export interface SegmentContext {
  // From pi-mono
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  sessionId: string | undefined;
  
  // Computed
  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;
  
  // Git
  git: GitStatus;
  
  // Extension statuses
  extensionStatuses: ReadonlyMap<string, string>;
  
  // Options
  options: StatusLineSegmentOptions;
  width: number;
}

// Rendered segment output
export interface RenderedSegment {
  content: string;
  visible: boolean;
}

// Segment definition
export interface StatusLineSegment {
  id: StatusLineSegmentId;
  render(ctx: SegmentContext): RenderedSegment;
}
