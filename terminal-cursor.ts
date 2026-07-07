export interface InlineEditorCursorRestorePosition {
  rows?: unknown;
  cursorRow?: unknown;
  previousViewportTop?: unknown;
}

export function clampTerminalRow(rows: unknown): number {
  return typeof rows === "number" && Number.isFinite(rows) && rows > 0
    ? Math.max(1, Math.floor(rows))
    : 1;
}

export function inlineEditorQuitCursorRow(position: InlineEditorCursorRestorePosition): number {
  const terminalRows = clampTerminalRow(position.rows);
  if (typeof position.cursorRow !== "number" || !Number.isFinite(position.cursorRow)) {
    return terminalRows;
  }

  const viewportTop = typeof position.previousViewportTop === "number" && Number.isFinite(position.previousViewportTop)
    ? position.previousViewportTop
    : 0;
  const screenRow = Math.floor(position.cursorRow - viewportTop + 1);
  return Math.min(terminalRows, Math.max(1, screenRow));
}

export function inlineEditorQuitCursorRestore(position: InlineEditorCursorRestorePosition): string {
  return `\x1b[${inlineEditorQuitCursorRow(position)};1H\x1b[2K\x1b[?25h\n`;
}
