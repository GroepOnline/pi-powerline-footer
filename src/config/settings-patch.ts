import { isRecord } from "./primitives.ts";
import type { PowerlineConfig } from "./parse.ts";
import type { StatusLinePreset } from "./types.ts";

export function nextPowerlineSettingWithPreset(
  existingPowerlineSetting: unknown,
  preset: StatusLinePreset,
): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return preset;
  }
  return { ...existingPowerlineSetting, preset };
}

export function nextPowerlineSettingWithOptions(
  existingPowerlineSetting: unknown,
  updates: Partial<
    Pick<PowerlineConfig, "welcome" | "stashSharpSShortcut" | "placement">
  >,
  currentPreset: StatusLinePreset,
): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return { preset: currentPreset, ...updates };
  }
  return { ...existingPowerlineSetting, ...updates };
}
