import {
  truncateToWidth as tuiTruncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { ansi, fgOnly, getFgAnsiCode } from "../theme/colors.ts";
import { formatTokens } from "./format.ts";
import type { LoadedCounts, RecentSession } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Shared rendering utilities
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "     . *      ",
  "   * ╭───╮ .  ",
  "  .  │   │  * ",
  "     │   │    ",
  "   * ╰─┬─╯ .  ",
  "  .    ┴      ",
];

const GRADIENT_COLORS = [
  "\x1b[38;5;199m",
  "\x1b[38;5;171m",
  "\x1b[38;5;135m",
  "\x1b[38;5;99m",
  "\x1b[38;5;75m",
  "\x1b[38;5;51m",
];

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

export function dim(text: string): string {
  return getFgAnsiCode("sep") + text + ansi.reset;
}

function gradientLine(line: string): string {
  const reset = ansi.reset;
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1)
      colorIdx++;
    const char = line[i];
    if (char !== " ") {
      result += GRADIENT_COLORS[colorIdx] + char + reset;
    } else {
      result += char;
    }
  }
  return result;
}

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return tuiTruncateToWidth(text, width, "…");
  if (visLen === width) return text;
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function fitToWidth(str: string, width: number): string {
  const visLen = visibleWidth(str);
  if (visLen > width) return tuiTruncateToWidth(str, width, "…");
  return str + " ".repeat(width - visLen);
}

export interface WelcomeData {
  modelName: string;
  providerName: string;
  recentSessions: RecentSession[];
  loadedCounts: LoadedCounts;
  initialContextTokens: number | null;
  queueCount?: number;
  hasStash?: boolean;
}

function buildLeftColumn(data: WelcomeData, colWidth: number): string[] {
  const logoColored = PI_LOGO.map((line) => gradientLine(line));

  return [
    "",
    ...logoColored.map((l) => centerText(l, colWidth)),
    "",
    centerText(fgOnly("model", data.modelName), colWidth),
    centerText(dim(data.providerName), colWidth),
  ];
}

function buildRightColumn(data: WelcomeData, colWidth: number): string[] {
  const hChar = "─";
  const separator = ` ${dim(hChar.repeat(Math.max(1, colWidth - 2)))}`;
  const lines: string[] = [];

  // 1. Signals & Wishes
  lines.push(` ${bold(fgOnly("accent", "Signals & Wishes"))}`);
  lines.push(` ${dim("Write it down, let it rise, keep your focus clear.")}`);
  lines.push(separator);

  // 2. Active Horizon
  lines.push(` ${bold(fgOnly("accent", "Active Horizon"))}`);
  const itemPrefix = dim("- ");
  
  if (data.queueCount && data.queueCount > 0) {
    lines.push(` ${itemPrefix}${fgOnly("gitClean", `${data.queueCount}`)} queued items ready`);
  } else {
    lines.push(` ${itemPrefix}type ${fgOnly("model", "# <idea>")} to capture a thought`);
  }

  if (data.hasStash) {
    lines.push(` ${itemPrefix}${fgOnly("gitClean", "1")} draft stashed (Alt+S to pop)`);
  } else {
    lines.push(` ${itemPrefix}press ${fgOnly("model", "alt+s")} to park a draft`);
  }

  if (
    data.initialContextTokens !== null &&
    Number.isFinite(data.initialContextTokens) &&
    data.initialContextTokens > 0
  ) {
    lines.push(
      ` ${itemPrefix}${fgOnly("gitClean", `≈ ${formatTokens(data.initialContextTokens)}`)} initial prompt tokens`,
    );
  }

  const { extensions, skills } = data.loadedCounts;
  const toolsCount = extensions + skills;
  if (toolsCount > 0) {
    lines.push(` ${itemPrefix}${fgOnly("gitClean", `${toolsCount}`)} skills/extensions loaded`);
  }

  lines.push(` ${itemPrefix}${dim("dreaming & mission queue ready")}`);
  lines.push(separator);

  // 3. Quick Launch / Tactical
  lines.push(` ${bold(fgOnly("accent", "Quick Launch / Tactical"))}`);
  lines.push(` ${dim("# <idea>  ")} capture idea to queue`);
  lines.push(` ${dim("alt+p     ")} tactical powerline overlay`);
  lines.push(` ${dim("!cmd      ")} sticky bash session`);
  lines.push(` ${dim("alt+s     ")} stash/pop prompt draft`);
  lines.push(separator);

  // 4. Recent Crafts
  lines.push(` ${bold(fgOnly("accent", "Recent Crafts"))}`);
  if (data.recentSessions.length === 0) {
    lines.push(` ${dim("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions.slice(0, 3)) {
      lines.push(
        ` ${dim("• ")}${fgOnly("path", session.name)}${dim(` (${session.timeAgo})`)}`,
      );
    }
  }

  lines.push(""); // Padding at bottom
  return lines;
}

export function renderWelcomeBox(
  data: WelcomeData,
  termWidth: number,
  bottomLine: string,
): string[] {
  // Minimum width for two-column layout: leftCol(26) + separator(3) + minRightCol(15) = 44
  const minLayoutWidth = 44;

  // If terminal is too narrow for the layout, return empty (skip welcome box)
  if (termWidth < minLayoutWidth) {
    return [];
  }

  const minWidth = 76;
  const maxWidth = 96;
  // Clamp to termWidth to prevent crash on narrow terminals
  const boxWidth = Math.min(
    termWidth,
    Math.max(minWidth, Math.min(termWidth - 2, maxWidth)),
  );
  const leftCol = 26;
  const rightCol = Math.max(1, boxWidth - leftCol - 3); // Ensure rightCol is at least 1

  const hChar = "─";
  const v = dim("│");
  const tl = dim("╭");
  const tr = dim("╮");
  const bl = dim("╰");
  const br = dim("╯");

  const leftLines = buildLeftColumn(data, leftCol);
  const rightLines = buildRightColumn(data, rightCol);

  const lines: string[] = [];

  // Top border with title
  const title = " pi-wishcraft ";
  const titlePrefix = dim(hChar.repeat(3));
  const titleStyled = titlePrefix + fgOnly("model", title);
  const titleVisLen = 3 + visibleWidth(title);
  const afterTitle = boxWidth - 2 - titleVisLen;
  const afterTitleText = afterTitle > 0 ? dim(hChar.repeat(afterTitle)) : "";
  lines.push(tl + titleStyled + afterTitleText + tr);

  // Content rows
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const left = fitToWidth(leftLines[i] ?? "", leftCol);
    const right = fitToWidth(rightLines[i] ?? "", rightCol);
    lines.push(v + left + v + right + v);
  }

  // Bottom border
  lines.push(bl + bottomLine + br);

  return lines;
}
