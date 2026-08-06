import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { GhostSuggestion } from "./types.ts";

/**
 * Overlay the ghost suggestion suffix on the editor's prompt line. Returns a
 * copy of the rendered lines with the ghost applied, or null when the ghost
 * cannot be shown (multi-line input, cursor not at end, already-typed text
 * mismatch, or a terminal too narrow). Callers fall back to the original
 * lines when this returns null.
 */
export function overlayGhostSuggestion(
  lines: string[],
  width: number,
  text: string,
  ghost: GhostSuggestion,
  cursor: { line: number; col: number },
): string[] | null {
  if (text.includes("\n")) return null;
  if (cursor.line !== 0 || cursor.col !== text.length) return null;
  if (!ghost.value.startsWith(text) || ghost.value === text) return null;
  if (lines.length < 3) return null;

  const suffix = ghost.value.slice(text.length);
  const contentLine = 1;
  const cursorBlock = "\x1b[7m \x1b[0m";
  const availableWidth = Math.max(0, width - visibleWidth(text) - 1);
  if (availableWidth === 0) return null;

  const shownSuffix = truncateToWidth(suffix, availableWidth, "", true);
  if (!shownSuffix) return null;

  const padding = " ".repeat(
    Math.max(0, width - visibleWidth(text) - 1 - visibleWidth(shownSuffix)),
  );
  const ghostText = `\x1b[38;5;244m${shownSuffix}\x1b[0m`;
  const next = [...lines];
  next[contentLine] = `${text}${cursorBlock}${ghostText}${padding}`;
  return next;
}
