import {
  normalizeCustomItems,
  normalizeCustomPresets,
  normalizeCustomSegments,
} from "./custom-items.ts";
import {
  isRecord,
  normalizeCaptureSigil,
  normalizePlacement,
  normalizePreset,
  normalizeSegmentLabels,
  normalizeSeparator,
} from "./primitives.ts";
import { normalizeDisabledSegments, normalizeLayout } from "./segment-ids.ts";
import { normalizeSegmentOptions } from "./segment-options.ts";
import type {
  CustomSegmentConfig,
  CustomStatusItem,
  PowerlinePlacement,
  StatusLineLayout,
  StatusLinePreset,
  StatusLineSegmentId,
  StatusLineSegmentOptions,
  StatusLineSeparatorStyle,
} from "./types.ts";

export interface PowerlineConfig {
  preset: StatusLinePreset;
  customItems: CustomStatusItem[];
  disabledSegments: StatusLineSegmentId[];
  invalidDisabledSegments: string[];
  layout: StatusLineLayout | null;
  invalidLayoutSegments: string[];
  separator: StatusLineSeparatorStyle | null;
  segmentOptions: StatusLineSegmentOptions;
  placement: PowerlinePlacement;
  invalidPlacement: string | null;
  welcome: boolean;
  stashSharpSShortcut: boolean;
  queue: { captureSigil: string | false };
  /** User-defined computed segments (command/env/static), keyed by id */
  segments: Record<string, CustomSegmentConfig>;
  /** User-defined presets, keyed by name */
  presets: Record<string, import("./types.ts").CustomPresetConfig>;
  /** Per-segment custom text label shown before the value (e.g. tps -> "speed"). */
  segmentLabels: Record<string, string>;
}

export function parsePowerlineConfig(
  value: unknown,
  presets: readonly StatusLinePreset[],
): PowerlineConfig {
  const defaultConfig: PowerlineConfig = {
    preset: "default",
    customItems: [],
    disabledSegments: [],
    invalidDisabledSegments: [],
    layout: null,
    invalidLayoutSegments: [],
    separator: null,
    segmentOptions: {},
    placement: "above",
    invalidPlacement: null,
    welcome: true,
    stashSharpSShortcut: false,
    queue: { captureSigil: "#" },
    segments: {},
    presets: {},
    segmentLabels: {},
  };

  const directPreset = normalizePreset(value, presets);
  if (directPreset) return { ...defaultConfig, preset: directPreset };

  if (!isRecord(value)) return defaultConfig;

  const customItems = normalizeCustomItems(value.customItems);
  const customSegments = normalizeCustomSegments(value.segments);
  const customSegmentIds = new Set(Object.keys(customSegments));
  const { disabledSegments, invalidDisabledSegments } =
    normalizeDisabledSegments(
      value.disabledSegments,
      customItems,
      customSegmentIds,
    );
  const { layout, invalidLayoutSegments } = normalizeLayout(
    value.layout,
    customItems,
    customSegmentIds,
  );
  const { placement, invalidPlacement } = normalizePlacement(value.placement);
  const queue = isRecord(value.queue)
    ? { captureSigil: normalizeCaptureSigil(value.queue.captureSigil) }
    : defaultConfig.queue;
  const customItemIds = new Set(customItems.map((item) => item.id));
  const customPresetDefs = normalizeCustomPresets(
    value.presets,
    customItemIds,
    customSegmentIds,
  );
  const requestedPreset =
    typeof value.preset === "string" ? value.preset.trim().toLowerCase() : "";
  const preset =
    normalizePreset(value.preset, presets) ??
    (Object.prototype.hasOwnProperty.call(customPresetDefs, requestedPreset)
      ? (requestedPreset as StatusLinePreset)
      : defaultConfig.preset);

  return {
    preset,
    customItems,
    disabledSegments,
    invalidDisabledSegments,
    layout,
    invalidLayoutSegments,
    separator: normalizeSeparator(value.separator),
    segmentOptions: normalizeSegmentOptions(value),
    placement,
    invalidPlacement,
    welcome: value.welcome !== false,
    stashSharpSShortcut: value.stashSharpSShortcut === true,
    queue,
    segments: customSegments,
    presets: customPresetDefs,
    segmentLabels: normalizeSegmentLabels(value.segmentLabels),
  };
}
