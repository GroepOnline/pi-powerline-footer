import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { FixedEditorClusterRender } from "./cluster.ts";

export interface TerminalLike {
  columns: number;
  rows: number;
  kittyProtocolActive?: boolean;
  write(data: string): void;
}

interface TerminalSplitCompositorOptions {
  tui: any;
  terminal: TerminalLike;
  renderCluster: (width: number, terminalRows: number) => FixedEditorClusterRender;
  getShowHardwareCursor?: () => boolean;
  mouseScroll?: boolean;
  onCopySelection?: (text: string) => void;
}

interface PatchedRenderable {
  render(width: number): string[];
}

interface RenderPatch {
  target: PatchedRenderable;
  originalRender: (width: number) => string[];
}

interface RenderPassCluster {
  width: number;
  terminalRows: number;
  cluster: FixedEditorClusterRender;
}

interface SgrMousePacket {
  code: number;
  col: number;
  row: number;
  final: "M" | "m";
}

interface SelectionPoint {
  line: number;
  col: number;
}

type SelectionArea = "root" | "cluster";

interface SelectionLocation {
  area: SelectionArea;
  point: SelectionPoint;
}

interface DisposeOptions {
  resetExtendedKeyboardModes?: boolean;
}

type ExtendedKeyboardMode = "kitty" | "modifyOtherKeys";

export function beginSynchronizedOutput(): string {
  return "\x1b[?2026h";
}

export function endSynchronizedOutput(): string {
  return "\x1b[?2026l";
}

export function setScrollRegion(top: number, bottom: number): string {
  return `\x1b[${top};${bottom}r`;
}

export function resetScrollRegion(): string {
  return "\x1b[r";
}

export function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function clearLine(): string {
  return "\x1b[2K";
}

function hideCursor(): string {
  return "\x1b[?25l";
}

function showCursor(): string {
  return "\x1b[?25h";
}

function enterAlternateScreen(): string {
  return "\x1b[?1049h";
}

function exitAlternateScreen(): string {
  return "\x1b[?1049l";
}

function enableAlternateScrollMode(): string {
  return "\x1b[?1007h";
}

function disableAlternateScrollMode(): string {
  return "\x1b[?1007l";
}

function enableMouseReporting(): string {
  return "\x1b[?1002h\x1b[?1006h";
}

function disableMouseReporting(): string {
  return "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
}

function enableExtendedKeyboardMode(mode: ExtendedKeyboardMode): string {
  return mode === "kitty" ? "\x1b[>7u" : "\x1b[>4;2m";
}

function disableExtendedKeyboardMode(mode: ExtendedKeyboardMode): string {
  return mode === "kitty" ? "\x1b[<u" : "\x1b[>4;0m";
}

function resetExtendedKeyboardModes(): string {
  return "\x1b[<999u\x1b[>4;0m";
}

function parseKeyboardScrollDelta(data: string): number {
  if (matchesKey(data, "pageUp")) return 10;
  if (matchesKey(data, "pageDown")) return -10;
  return 0;
}

function parseSgrMousePackets(data: string): SgrMousePacket[] | null {
  const pattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  const packets: SgrMousePacket[] = [];
  let offset = 0;

  for (const match of data.matchAll(pattern)) {
    if (match.index !== offset) return null;
    offset = match.index + match[0].length;
    packets.push({
      code: Number(match[1]),
      col: Number(match[2]),
      row: Number(match[3]),
      final: match[4] as "M" | "m",
    });
  }

  return packets.length > 0 && offset === data.length ? packets : null;
}

function mouseBaseButton(code: number): number {
  return code & ~(4 | 8 | 16 | 32);
}

function mouseScrollDelta(packet: SgrMousePacket): number {
  if (packet.final !== "M") return 0;
  const baseButton = mouseBaseButton(packet.code);
  if (baseButton === 64) return 3;
  if (baseButton === 65) return -3;
  return 0;
}

function isLeftPress(packet: SgrMousePacket): boolean {
  return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) === 0;
}

function isLeftDrag(packet: SgrMousePacket): boolean {
  return packet.final === "M" && mouseBaseButton(packet.code) === 0 && (packet.code & 32) !== 0;
}

function isMouseRelease(packet: SgrMousePacket): boolean {
  return packet.final === "m";
}

function stripAnsi(line: string): string {
  return line
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function sliceColumns(text: string, startCol: number, endCol: number): string {
  let col = 0;
  let result = "";
  for (const char of text) {
    const width = Math.max(0, visibleWidth(char));
    const nextCol = col + width;
    if (nextCol > startCol && col < endCol) {
      result += char;
    }
    col = nextCol;
  }
  return result;
}

function compareSelectionPoints(a: SelectionPoint, b: SelectionPoint): number {
  return a.line === b.line ? a.col - b.col : a.line - b.line;
}

function descriptorForRows(terminal: TerminalLike): PropertyDescriptor | undefined {
  let target: object | null = terminal;
  while (target) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "rows");
    if (descriptor) return descriptor;
    target = Object.getPrototypeOf(target);
  }

  return undefined;
}

function readRows(terminal: TerminalLike, descriptor: PropertyDescriptor | undefined): number {
  if (descriptor?.get) {
    const value = descriptor.get.call(terminal);
    return typeof value === "number" && Number.isFinite(value) ? value : 24;
  }

  const value = Reflect.get(terminal, "rows");
  return typeof value === "number" && Number.isFinite(value) ? value : 24;
}

function sanitizeLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

export function buildFixedClusterPaint(
  cluster: FixedEditorClusterRender,
  terminalRows: number,
  width: number,
  showHardwareCursor: boolean,
): string {
  if (cluster.lines.length === 0) return "";

  const startRow = Math.max(1, terminalRows - cluster.lines.length + 1);
  let buffer = resetScrollRegion();

  for (let i = 0; i < cluster.lines.length; i++) {
    buffer += moveCursor(startRow + i, 1);
    buffer += clearLine();
    buffer += sanitizeLine(cluster.lines[i] ?? "", width);
  }

  if (cluster.cursor && showHardwareCursor) {
    buffer += moveCursor(startRow + cluster.cursor.row, Math.max(1, cluster.cursor.col + 1));
    buffer += showCursor();
  } else {
    buffer += hideCursor();
  }

  return buffer;
}

export class TerminalSplitCompositor {
  private readonly tui: any;
  private readonly terminal: TerminalLike;
  private readonly renderCluster: (width: number, terminalRows: number) => FixedEditorClusterRender;
  private readonly getShowHardwareCursor: () => boolean;
  private readonly mouseScroll: boolean;
  private readonly onCopySelection: ((text: string) => void) | null;
  private extendedKeyboardMode: ExtendedKeyboardMode | null = null;
  private readonly rowsDescriptor: PropertyDescriptor | undefined;
  private readonly originalWrite: (data: string) => void;
  private readonly originalDoRender: (() => void) | null;
  private readonly originalRender: ((width: number) => string[]) | null;
  private readonly patchedRenders: RenderPatch[] = [];
  private removeInputListener: (() => void) | null = null;
  private emergencyCleanup: (() => void) | null = null;
  private installed = false;
  private disposed = false;
  private writing = false;
  private renderPassActive = false;
  private renderPassCluster: RenderPassCluster | null = null;
  private renderingCluster = false;
  private renderingScrollableRoot = false;
  private checkingOverlay = false;
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private lastRootLineCount = 0;
  private visibleRootStart = 0;
  private visibleScrollableRows = 0;
  private visibleRootLines: string[] = [];
  private visibleClusterLines: string[] = [];
  private selectionArea: SelectionArea | null = null;
  private selectionAnchor: SelectionPoint | null = null;
  private selectionFocus: SelectionPoint | null = null;
  private selectionDragging = false;

  constructor(options: TerminalSplitCompositorOptions) {
    this.tui = options.tui;
    this.terminal = options.terminal;
    this.renderCluster = options.renderCluster;
    this.getShowHardwareCursor = options.getShowHardwareCursor ?? (() => false);
    this.mouseScroll = options.mouseScroll !== false;
    this.onCopySelection = options.onCopySelection ?? null;
    this.rowsDescriptor = descriptorForRows(options.terminal);
    this.originalWrite = options.terminal.write.bind(options.terminal);
    this.originalDoRender = typeof options.tui.doRender === "function" ? options.tui.doRender.bind(options.tui) : null;
    this.originalRender = typeof options.tui.render === "function" ? options.tui.render.bind(options.tui) : null;
  }

  install(): void {
    if (this.installed) return;
    if (typeof this.terminal.write !== "function") {
      throw new Error("[powerline-footer] Fixed editor compositor expected terminal.write(data) to exist");
    }

    this.originalWrite(
      beginSynchronizedOutput()
      + enterAlternateScreen()
      + this.enableAlternateScreenKeyboardMode()
      + disableAlternateScrollMode()
      + (this.mouseScroll ? enableMouseReporting() : "")
      + endSynchronizedOutput(),
    );
    this.emergencyCleanup = () => {
      if (!this.disposed) {
        this.restoreTerminalStateForExit();
      }
    };
    process.once("exit", this.emergencyCleanup);

    Object.defineProperty(this.terminal, "rows", {
      configurable: true,
      get: () => this.getScrollableRows(),
    });

    if (this.originalRender) {
      this.tui.render = (width: number) => this.renderScrollableRoot(width);
    }

    if (typeof this.tui.addInputListener === "function") {
      this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));
    }

    this.terminal.write = (data: string) => this.write(data);
    if (this.originalDoRender) {
      this.tui.doRender = () => {
        this.renderPassActive = true;
        this.renderPassCluster = null;
        try {
          this.originalDoRender?.();
          this.requestRepaint();
        } finally {
          this.renderPassActive = false;
          this.renderPassCluster = null;
        }
      };
    }
    this.installed = true;
  }

  hideRenderable(target: PatchedRenderable): void {
    if (this.patchedRenders.some((patch) => patch.target === target)) return;
    const originalRender = target.render.bind(target);
    this.patchedRenders.push({ target, originalRender });
    target.render = () => [];
  }

  renderHidden(target: PatchedRenderable, width: number): string[] {
    const patch = this.patchedRenders.find((candidate) => candidate.target === target);
    const render = patch?.originalRender ?? target.render.bind(target);
    return render(width);
  }

  jumpToPreviousRootTarget(targetLines: readonly number[]): boolean {
    return this.jumpToRootTarget(targetLines, "previous");
  }

  jumpToNextRootTarget(targetLines: readonly number[]): boolean {
    return this.jumpToRootTarget(targetLines, "next");
  }

  jumpToRootBottom(): boolean {
    if (this.disposed || this.hasVisibleOverlay() || this.scrollOffset === 0) return false;

    this.clearSelection();
    this.scrollOffset = 0;
    this.requestRender();
    return true;
  }

  private jumpToRootTarget(targetLines: readonly number[], direction: "previous" | "next"): boolean {
    if (this.disposed || targetLines.length === 0 || this.hasVisibleOverlay()) return false;

    const start = this.visibleRootStart;
    const candidates = direction === "previous"
      ? targetLines.filter((line) => line < start).sort((a, b) => b - a)
      : targetLines.filter((line) => line > start).sort((a, b) => a - b);

    for (const target of candidates) {
      const nextOffset = Math.max(0, Math.min(
        this.lastRootLineCount - Math.max(1, this.visibleScrollableRows) - target,
        this.maxScrollOffset,
      ));
      if (nextOffset === this.scrollOffset) continue;

      this.clearSelection();
      this.scrollOffset = nextOffset;
      this.requestRender();
      return true;
    }

    return false;
  }

  requestRepaint(): void {
    if (this.disposed || this.hasVisibleOverlay()) return;
    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCluster(width, rawRows);
    if (cluster.lines.length === 0) return;

    this.originalWrite(
      beginSynchronizedOutput()
      + buildFixedClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor())
      + endSynchronizedOutput(),
    );
  }

  dispose(options: DisposeOptions = {}): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const patch of this.patchedRenders.splice(0)) {
      patch.target.render = patch.originalRender;
    }

    this.removeInputListener?.();
    this.removeInputListener = null;
    if (this.emergencyCleanup) {
      process.removeListener("exit", this.emergencyCleanup);
      this.emergencyCleanup = null;
    }

    this.terminal.write = this.originalWrite;
    if (this.originalDoRender) {
      this.tui.doRender = this.originalDoRender;
    }
    if (this.originalRender) {
      this.tui.render = this.originalRender;
    }
    if (this.rowsDescriptor) {
      Object.defineProperty(this.terminal, "rows", this.rowsDescriptor);
    } else {
      Reflect.deleteProperty(this.terminal, "rows");
    }

    this.restoreTerminalState(options);
  }

  private getRawRows(): number {
    return Math.max(2, readRows(this.terminal, this.rowsDescriptor));
  }

  private getScrollableRows(): number {
    if (this.disposed || this.writing || this.renderingCluster || this.checkingOverlay || this.hasVisibleOverlay()) {
      return this.getRawRows();
    }

    const rawRows = this.getRawRows();
    const width = Math.max(1, this.terminal.columns || 80);
    const cluster = this.getCluster(width, rawRows);
    return Math.max(1, rawRows - cluster.lines.length);
  }

  private renderScrollableRoot(width: number): string[] {
    if (!this.originalRender || this.disposed || this.renderingScrollableRoot || this.hasVisibleOverlay()) {
      return this.originalRender?.(width) ?? [];
    }

    this.renderingScrollableRoot = true;
    try {
      const rawRows = this.getRawRows();
      const renderWidth = Math.max(1, width);
      const cluster = this.getCluster(renderWidth, rawRows);
      const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
      const lines = this.originalRender(renderWidth);
      if (this.scrollOffset > 0 && this.lastRootLineCount > 0 && lines.length > this.lastRootLineCount) {
        this.scrollOffset += lines.length - this.lastRootLineCount;
      }
      this.lastRootLineCount = lines.length;
      this.maxScrollOffset = Math.max(0, lines.length - scrollableRows);
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScrollOffset));

      const start = Math.max(0, lines.length - scrollableRows - this.scrollOffset);
      const visibleLines = lines.slice(start, start + scrollableRows);
      while (visibleLines.length < scrollableRows) {
        visibleLines.push("");
      }
      this.visibleRootStart = start;
      this.visibleScrollableRows = scrollableRows;
      this.visibleRootLines = visibleLines;
      return visibleLines.map((line, index) => this.renderSelectionHighlight(line, start + index, "root"));
    } finally {
      this.renderingScrollableRoot = false;
    }
  }

  private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
    if (this.disposed || this.hasVisibleOverlay()) return undefined;

    const mousePackets = this.mouseScroll ? parseSgrMousePackets(data) : null;
    if (mousePackets) {
      for (const packet of mousePackets) {
        this.handleMousePacket(packet);
      }
      return { consume: true };
    }

    const keyboardDelta = parseKeyboardScrollDelta(data);
    if (keyboardDelta === 0) return undefined;

    this.scrollBy(keyboardDelta);
    return { consume: true };
  }

  private handleMousePacket(packet: SgrMousePacket): void {
    const delta = mouseScrollDelta(packet);
    if (delta !== 0) {
      this.selectionDragging = false;
      this.scrollBy(delta);
      return;
    }

    const location = this.selectionLocationForPacket(packet);

    if (this.selectionDragging && isMouseRelease(packet)) {
      this.selectionFocus = location?.area === this.selectionArea
        ? location.point
        : this.clampedSelectionPointForPacket(packet, this.selectionArea);
      this.selectionDragging = false;
      const selectedText = this.getSelectedText();
      if (selectedText) {
        this.onCopySelection?.(selectedText);
      } else {
        this.clearSelection();
      }
      this.requestRender();
      return;
    }

    if (!location) return;

    if (isLeftPress(packet)) {
      this.selectionArea = location.area;
      this.selectionAnchor = location.point;
      this.selectionFocus = location.point;
      this.selectionDragging = true;
      this.requestRender();
      return;
    }

    if (this.selectionDragging && isLeftDrag(packet) && location.area === this.selectionArea) {
      this.selectionFocus = location.point;
      this.requestRender();
      return;
    }
  }

  private selectionLocationForPacket(packet: SgrMousePacket): SelectionLocation | null {
    if (packet.row < 1) return null;

    const col = Math.max(0, packet.col - 1);
    if (packet.row <= this.visibleScrollableRows) {
      return {
        area: "root",
        point: { line: this.visibleRootStart + packet.row - 1, col },
      };
    }

    const clusterLine = packet.row - this.visibleScrollableRows - 1;
    if (clusterLine >= this.visibleClusterLines.length) return null;

    return {
      area: "cluster",
      point: { line: clusterLine, col },
    };
  }

  private clampedSelectionPointForPacket(packet: SgrMousePacket, area: SelectionArea | null): SelectionPoint {
    if (area === "cluster") {
      return {
        line: Math.max(0, Math.min(packet.row - this.visibleScrollableRows - 1, this.visibleClusterLines.length - 1)),
        col: Math.max(0, packet.col - 1),
      };
    }

    const row = Math.max(1, Math.min(packet.row, this.visibleScrollableRows));
    return {
      line: this.visibleRootStart + row - 1,
      col: Math.max(0, packet.col - 1),
    };
  }

  private renderSelectionHighlight(line: string, lineIndex: number, area: SelectionArea): string {
    const range = this.getSelectionRangeForLine(lineIndex, area);
    if (!range) return line;

    const plain = stripAnsi(line);
    const startCol = Math.max(0, Math.min(range.startCol, visibleWidth(plain)));
    const endCol = Math.max(startCol, Math.min(range.endCol, visibleWidth(plain)));
    if (startCol === endCol) return line;

    const before = sliceColumns(plain, 0, startCol);
    const selected = sliceColumns(plain, startCol, endCol);
    const after = sliceColumns(plain, endCol, Number.POSITIVE_INFINITY);
    return `${before}\x1b[7m${selected}\x1b[27m${after}`;
  }

  private getSelectedText(): string {
    if (!this.selectionArea || !this.selectionAnchor || !this.selectionFocus) return "";

    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (start.line === end.line && start.col === end.col) return "";

    const lines = this.selectionArea === "root" ? this.visibleRootLines : this.visibleClusterLines;
    const firstLine = this.selectionArea === "root" ? this.visibleRootStart : 0;
    const selected: string[] = [];
    for (let lineIndex = start.line; lineIndex <= end.line; lineIndex++) {
      const line = stripAnsi(lines[lineIndex - firstLine] ?? "");
      const startCol = lineIndex === start.line ? start.col : 0;
      const endCol = lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY;
      selected.push(sliceColumns(line, startCol, endCol));
    }

    return selected.join("\n").replace(/[ \t]+$/gm, "").trimEnd();
  }

  private getSelectionRangeForLine(lineIndex: number, area: SelectionArea): { startCol: number; endCol: number } | null {
    if (this.selectionArea !== area || !this.selectionAnchor || !this.selectionFocus) return null;

    const start = compareSelectionPoints(this.selectionAnchor, this.selectionFocus) <= 0
      ? this.selectionAnchor
      : this.selectionFocus;
    const end = start === this.selectionAnchor ? this.selectionFocus : this.selectionAnchor;
    if (lineIndex < start.line || lineIndex > end.line) return null;

    return {
      startCol: lineIndex === start.line ? start.col : 0,
      endCol: lineIndex === end.line ? end.col : Number.POSITIVE_INFINITY,
    };
  }

  private scrollBy(delta: number): void {
    const nextOffset = Math.max(0, Math.min(this.scrollOffset + delta, this.maxScrollOffset));
    if (nextOffset === this.scrollOffset) return;

    this.clearSelection();
    this.scrollOffset = nextOffset;
    this.requestRender();
  }

  private requestRender(): void {
    if (typeof this.tui.requestRender === "function") {
      this.tui.requestRender();
    }
  }

  private clearSelection(): void {
    this.selectionArea = null;
    this.selectionAnchor = null;
    this.selectionFocus = null;
    this.selectionDragging = false;
  }

  private activeExtendedKeyboardMode(): ExtendedKeyboardMode | null {
    if (this.terminal.kittyProtocolActive === true) return "kitty";
    if (Reflect.get(this.terminal, "_modifyOtherKeysActive") === true) return "modifyOtherKeys";
    return null;
  }

  private enableAlternateScreenKeyboardMode(): string {
    this.extendedKeyboardMode = this.activeExtendedKeyboardMode();
    return this.extendedKeyboardMode ? enableExtendedKeyboardMode(this.extendedKeyboardMode) : "";
  }

  private restoreTerminalState(options: DisposeOptions = {}): void {
    const activeMode = this.extendedKeyboardMode ?? this.activeExtendedKeyboardMode();
    const restoreMainScreenMode = !options.resetExtendedKeyboardModes && this.extendedKeyboardMode === null && activeMode !== null;

    this.originalWrite(
      beginSynchronizedOutput()
      + resetScrollRegion()
      + (this.mouseScroll ? disableMouseReporting() : "")
      + (activeMode ? disableExtendedKeyboardMode(activeMode) : "")
      + enableAlternateScrollMode()
      + exitAlternateScreen()
      + (restoreMainScreenMode && activeMode ? enableExtendedKeyboardMode(activeMode) : "")
      + (options.resetExtendedKeyboardModes ? resetExtendedKeyboardModes() : "")
      + endSynchronizedOutput(),
    );
  }

  private restoreTerminalStateForExit(): void {
    try {
      this.restoreTerminalState({ resetExtendedKeyboardModes: true });
    } catch {
      // Process-exit cleanup cannot report useful errors and must not throw.
    }
  }

  private write(data: string): void {
    if (this.disposed || this.writing || this.hasVisibleOverlay()) {
      this.originalWrite(data);
      return;
    }

    this.writing = true;
    try {
      const rawRows = this.getRawRows();
      const width = Math.max(1, this.terminal.columns || 80);
      const cluster = this.getCluster(width, rawRows);
      const reservedRows = cluster.lines.length;

      if (reservedRows === 0 || rawRows <= 2) {
        this.originalWrite(data);
        return;
      }

      const scrollBottom = Math.max(1, rawRows - reservedRows);
      const hardwareCursorRow = typeof this.tui.hardwareCursorRow === "number"
        ? this.tui.hardwareCursorRow
        : typeof this.tui.cursorRow === "number"
          ? this.tui.cursorRow
          : 0;
      const viewportTop = typeof this.tui.previousViewportTop === "number" ? this.tui.previousViewportTop : 0;
      const screenRow = Math.max(1, Math.min(scrollBottom, hardwareCursorRow - viewportTop + 1));
      const buffer = beginSynchronizedOutput()
        + setScrollRegion(1, scrollBottom)
        + moveCursor(screenRow, 1)
        + data
        + buildFixedClusterPaint(this.decorateCluster(cluster), rawRows, width, this.getShowHardwareCursor())
        + endSynchronizedOutput();

      this.originalWrite(buffer);
    } finally {
      this.writing = false;
    }
  }

  private getCluster(width: number, terminalRows: number): FixedEditorClusterRender {
    if (
      this.renderPassActive &&
      this.renderPassCluster?.width === width &&
      this.renderPassCluster.terminalRows === terminalRows
    ) {
      return this.renderPassCluster.cluster;
    }

    const cluster = this.withClusterRender(() => this.renderCluster(width, terminalRows));
    this.visibleClusterLines = cluster.lines;
    if (this.renderPassActive) {
      this.renderPassCluster = { width, terminalRows, cluster };
    }
    return cluster;
  }

  private decorateCluster(cluster: FixedEditorClusterRender): FixedEditorClusterRender {
    if (this.selectionArea !== "cluster") return cluster;

    return {
      ...cluster,
      lines: cluster.lines.map((line, index) => this.renderSelectionHighlight(line, index, "cluster")),
    };
  }

  private withClusterRender<T>(render: () => T): T {
    const wasRenderingCluster = this.renderingCluster;
    this.renderingCluster = true;
    try {
      return render();
    } finally {
      this.renderingCluster = wasRenderingCluster;
    }
  }

  private hasVisibleOverlay(): boolean {
    if (this.checkingOverlay) return false;

    this.checkingOverlay = true;
    try {
      if (typeof this.tui.hasOverlay === "function" && this.tui.hasOverlay()) {
        return true;
      }

      const overlayStack = Reflect.get(this.tui, "overlayStack");
      if (!Array.isArray(overlayStack)) {
        return false;
      }

      return overlayStack.some((entry) => entry && entry.hidden !== true);
    } finally {
      this.checkingOverlay = false;
    }
  }
}
