import {
  isRecord,
  normalizeCustomColor,
  normalizeCustomItemId,
  normalizeCustomItemPosition,
  normalizeCustomPrefix,
  normalizeCustomSegmentType,
  normalizeSeparator,
} from "./primitives.ts";
import { normalizeSegmentOptions } from "./segment-options.ts";
import { normalizeStatusLineSegmentId } from "./segment-ids.ts";
import type {
  ColorScheme,
  CustomSegmentConfig,
  CustomStatusItem,
  StatusLineSegmentId,
} from "./types.ts";

export function normalizeCustomSegments(
  raw: unknown,
): Record<string, CustomSegmentConfig> {
  const result: Record<string, CustomSegmentConfig> = {};
  if (!isRecord(raw)) return result;

  for (const [id, entry] of Object.entries(raw)) {
    if (!normalizeCustomItemId(id)) continue;
    if (!isRecord(entry)) continue;

    const type = normalizeCustomSegmentType(entry.type);
    if (!type) continue;

    if (type === "command") {
      if (typeof entry.command !== "string" || !entry.command.trim()) continue;
      result[id] = {
        type,
        command: entry.command.trim(),
        prefix: normalizeCustomPrefix(entry.prefix),
        color: normalizeCustomColor(entry.color),
        cacheMs:
          typeof entry.cacheMs === "number" && entry.cacheMs >= 0
            ? Math.floor(entry.cacheMs)
            : undefined,
      };
    } else if (type === "env") {
      if (typeof entry.env !== "string" || !entry.env.trim()) continue;
      result[id] = {
        type,
        env: entry.env.trim(),
        prefix: normalizeCustomPrefix(entry.prefix),
        color: normalizeCustomColor(entry.color),
        fallback:
          typeof entry.fallback === "string" ? entry.fallback : undefined,
      };
    } else {
      if (typeof entry.text !== "string") continue;
      result[id] = {
        type,
        text: entry.text,
        color: normalizeCustomColor(entry.color),
      };
    }
  }

  return result;
}

function normalizeCustomPresetSegmentList(
  raw: unknown,
  customItemIds: ReadonlySet<string>,
  customSegmentIds: ReadonlySet<string>,
): StatusLineSegmentId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: StatusLineSegmentId[] = [];
  for (const entry of raw) {
    const id = normalizeStatusLineSegmentId(
      entry,
      customItemIds,
      customSegmentIds,
    );
    if (id) result.push(id);
  }
  return result;
}

export function normalizeCustomPresets(
  raw: unknown,
  customItemIds: ReadonlySet<string>,
  customSegmentIds: ReadonlySet<string>,
): Record<string, import("./types.ts").CustomPresetConfig> {
  const result: Record<string, import("./types.ts").CustomPresetConfig> = {};
  if (!isRecord(raw)) return result;

  for (const [name, entry] of Object.entries(raw)) {
    const normalizedName = normalizeCustomItemId(name);
    if (!normalizedName) continue;
    const key = normalizedName.toLowerCase();
    if (!isRecord(entry)) continue;

    const preset: import("./types.ts").CustomPresetConfig = {};
    const left = normalizeCustomPresetSegmentList(
      entry.left,
      customItemIds,
      customSegmentIds,
    );
    const right = normalizeCustomPresetSegmentList(
      entry.right,
      customItemIds,
      customSegmentIds,
    );
    const secondary = normalizeCustomPresetSegmentList(
      entry.secondary,
      customItemIds,
      customSegmentIds,
    );
    if (left) preset.left = left;
    if (right) preset.right = right;
    if (secondary) preset.secondary = secondary;
    const sep = normalizeSeparator(entry.separator);
    if (sep) preset.separator = sep;
    if (isRecord(entry.colors)) {
      const colors: ColorScheme = {};
      for (const [key, val] of Object.entries(entry.colors)) {
        const cv = normalizeCustomColor(val);
        if (cv) colors[key as keyof ColorScheme] = cv;
      }
      if (Object.keys(colors).length > 0) preset.colors = colors;
    }
    if (isRecord(entry.segmentOptions)) {
      preset.segmentOptions = normalizeSegmentOptions(entry.segmentOptions);
    }
    result[key] = preset;
  }

  return result;
}

function normalizeCustomStatusItem(
  raw: unknown,
  idOverride?: string,
): CustomStatusItem | null {
  if (!isRecord(raw)) return null;
  const id = normalizeCustomItemId(idOverride ?? raw.id);
  if (!id) return null;

  const statusKey =
    typeof raw.statusKey === "string" && raw.statusKey.trim()
      ? raw.statusKey.trim()
      : id;

  return {
    id,
    statusKey,
    position: normalizeCustomItemPosition(raw.position),
    color: normalizeCustomColor(raw.color),
    prefix: normalizeCustomPrefix(raw.prefix),
    hideWhenMissing: raw.hideWhenMissing !== false,
    excludeFromExtensionStatuses: raw.excludeFromExtensionStatuses !== false,
  };
}

export function normalizeCustomItems(raw: unknown): CustomStatusItem[] {
  const normalized: CustomStatusItem[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = normalizeCustomStatusItem(entry);
      if (item) normalized.push(item);
    }
  } else if (isRecord(raw)) {
    for (const [id, entry] of Object.entries(raw)) {
      const item = normalizeCustomStatusItem(entry, id);
      if (item) normalized.push(item);
    }
  }

  const deduped = new Map<string, CustomStatusItem>();
  for (const item of normalized) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()];
}
