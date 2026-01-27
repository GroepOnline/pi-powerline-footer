import type { PresetDef, StatusLinePreset } from "./types.js";

export const PRESETS: Record<StatusLinePreset, PresetDef> = {
  default: {
    leftSegments: ["pi", "path", "model", "thinking", "git", "context_pct", "cache_read", "cost"],
    rightSegments: [],
    secondarySegments: ["extension_statuses"],
    separator: "powerline-thin",
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  minimal: {
    leftSegments: ["path", "git"],
    rightSegments: ["context_pct"],
    separator: "slash",
    segmentOptions: {
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
    },
  },

  compact: {
    leftSegments: ["model", "git"],
    rightSegments: ["cost", "context_pct"],
    separator: "powerline-thin",
    segmentOptions: {
      model: { showThinkingLevel: false },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  full: {
    leftSegments: ["pi", "hostname", "model", "thinking", "path", "git", "subagents"],
    rightSegments: ["token_in", "token_out", "cache_read", "cost", "context_pct", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 50 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: false },
    },
  },

  nerd: {
    leftSegments: ["pi", "hostname", "model", "thinking", "path", "git", "session", "subagents"],
    rightSegments: ["token_in", "token_out", "cache_read", "cache_write", "cost", "context_pct", "context_total", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 60 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: true },
    },
  },

  ascii: {
    leftSegments: ["model", "path", "git"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "ascii",
    segmentOptions: {
      model: { showThinkingLevel: true },
      path: { mode: "abbreviated", maxLength: 40 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  custom: {
    leftSegments: ["model", "path", "git"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "powerline-thin",
    segmentOptions: {},
  },
};

export function getPreset(name: StatusLinePreset): PresetDef {
  return PRESETS[name] ?? PRESETS.default;
}
