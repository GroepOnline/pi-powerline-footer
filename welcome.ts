import { readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ansi, fgOnly, getFgAnsiCode } from "./colors.js";

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedCounts {
  contextFiles: number;
  extensions: number;
  skills: number;
  promptTemplates: number;
}

/**
 * Welcome overlay component for pi agent.
 * Displays a branded splash screen with logo, tips, and loaded counts.
 * Includes a countdown timer for auto-dismiss.
 */
export class WelcomeComponent implements Component {
  private version: string;
  private modelName: string;
  private providerName: string;
  private recentSessions: RecentSession[];
  private loadedCounts: LoadedCounts;
  private countdown: number = 30;

  constructor(
    version: string,
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
  ) {
    this.version = version;
    this.modelName = modelName;
    this.providerName = providerName;
    this.recentSessions = recentSessions;
    this.loadedCounts = loadedCounts;
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Box dimensions - responsive with min/max
    const minWidth = 76;
    const maxWidth = 96;
    const boxWidth = Math.max(minWidth, Math.min(termWidth - 2, maxWidth));
    const leftCol = 26;
    const rightCol = boxWidth - leftCol - 3; // 3 = │ + │ + │

    // Block-based PI logo (gradient: magenta → cyan)
    const piLogo = [
      "▀████████████▀",
      " ╘███    ███  ",
      "  ███    ███  ",
      "  ███    ███  ",
      " ▄███▄  ▄███▄ ",
    ];

    // Apply gradient to logo
    const logoColored = piLogo.map((line) => this.gradientLine(line));

    // Left column - centered content
    const leftLines = [
      "",
      this.centerText(this.bold("Welcome back!"), leftCol),
      "",
      ...logoColored.map((l) => this.centerText(l, leftCol)),
      "",
      this.centerText(fgOnly("model", this.modelName), leftCol),
      this.centerText(this.dim(this.providerName), leftCol),
    ];

    // Right column separator
    const separatorWidth = rightCol - 2;
    const hChar = "─";
    const separator = ` ${this.dim(hChar.repeat(separatorWidth))}`;

    // Recent sessions content
    const sessionLines: string[] = [];
    if (this.recentSessions.length === 0) {
      sessionLines.push(` ${this.dim("No recent sessions")}`);
    } else {
      for (const session of this.recentSessions.slice(0, 3)) {
        sessionLines.push(
          ` ${this.dim("• ")}${fgOnly("path", session.name)}${this.dim(` (${session.timeAgo})`)}`,
        );
      }
    }

    // Loaded counts content
    const countLines: string[] = [];
    const { contextFiles, extensions, skills, promptTemplates } = this.loadedCounts;
    
    if (contextFiles > 0 || extensions > 0 || skills > 0 || promptTemplates > 0) {
      if (contextFiles > 0) {
        countLines.push(` ${this.checkmark()} ${fgOnly("gitClean", `${contextFiles}`)} context file${contextFiles !== 1 ? "s" : ""}`);
      }
      if (extensions > 0) {
        countLines.push(` ${this.checkmark()} ${fgOnly("gitClean", `${extensions}`)} extension${extensions !== 1 ? "s" : ""}`);
      }
      if (skills > 0) {
        countLines.push(` ${this.checkmark()} ${fgOnly("gitClean", `${skills}`)} skill${skills !== 1 ? "s" : ""}`);
      }
      if (promptTemplates > 0) {
        countLines.push(` ${this.checkmark()} ${fgOnly("gitClean", `${promptTemplates}`)} prompt template${promptTemplates !== 1 ? "s" : ""}`);
      }
    } else {
      countLines.push(` ${this.dim("No extensions loaded")}`);
    }

    // Right column
    const rightLines = [
      ` ${this.bold(fgOnly("accent", "Tips"))}`,
      ` ${this.dim("?")} for keyboard shortcuts`,
      ` ${this.dim("/")} for commands`,
      ` ${this.dim("!")} to run bash`,
      separator,
      ` ${this.bold(fgOnly("accent", "Loaded"))}`,
      ...countLines,
      separator,
      ` ${this.bold(fgOnly("accent", "Recent sessions"))}`,
      ...sessionLines,
      "",
    ];

    // Border characters (dim)
    const v = this.dim("│");
    const tl = this.dim("╭");
    const tr = this.dim("╮");
    const bl = this.dim("╰");
    const br = this.dim("╯");

    const lines: string[] = [];

    // Top border with embedded title
    const title = ` pi agent v${this.version} `;
    const titlePrefix = this.dim(hChar.repeat(3));
    const titleStyled = titlePrefix + fgOnly("model", title);
    const titleVisLen = 3 + visibleWidth(title);
    const afterTitle = boxWidth - 2 - titleVisLen;
    const afterTitleText = afterTitle > 0 ? this.dim(hChar.repeat(afterTitle)) : "";
    lines.push(tl + titleStyled + afterTitleText + tr);

    // Content rows
    const maxRows = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxRows; i++) {
      const left = this.fitToWidth(leftLines[i] ?? "", leftCol);
      const right = this.fitToWidth(rightLines[i] ?? "", rightCol);
      lines.push(v + left + v + right + v);
    }

    // Bottom border with countdown
    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = this.dim(countdownText);
    const bottomContentWidth = boxWidth - 2; // -2 for corners
    const countdownVisLen = visibleWidth(countdownText);
    const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
    const rightPad = bottomContentWidth - countdownVisLen - leftPad;
    
    lines.push(
      bl + 
      this.dim(hChar.repeat(Math.max(0, leftPad))) + 
      countdownStyled + 
      this.dim(hChar.repeat(Math.max(0, rightPad))) + 
      br
    );

    return lines;
  }

  private bold(text: string): string {
    return `\x1b[1m${text}\x1b[22m`;
  }

  private dim(text: string): string {
    return getFgAnsiCode("sep") + text + ansi.reset;
  }

  private checkmark(): string {
    return fgOnly("gitClean", "✓");
  }

  /** Center text within a given width */
  private centerText(text: string, width: number): string {
    const visLen = visibleWidth(text);
    if (visLen > width) {
      return this.truncateToWidth(text, width);
    }
    if (visLen === width) {
      return text; // Exact fit, no centering needed
    }
    const leftPad = Math.floor((width - visLen) / 2);
    const rightPad = width - visLen - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }

  /** Apply magenta→cyan gradient to a string */
  private gradientLine(line: string): string {
    const colors = [
      "\x1b[38;5;199m", // bright magenta
      "\x1b[38;5;171m", // magenta-purple
      "\x1b[38;5;135m", // purple
      "\x1b[38;5;99m",  // purple-blue
      "\x1b[38;5;75m",  // cyan-blue
      "\x1b[38;5;51m",  // bright cyan
    ];
    const reset = ansi.reset;

    let result = "";
    let colorIdx = 0;
    const step = Math.max(1, Math.floor(line.length / colors.length));

    for (let i = 0; i < line.length; i++) {
      if (i > 0 && i % step === 0 && colorIdx < colors.length - 1) {
        colorIdx++;
      }
      const char = line[i];
      if (char !== " ") {
        result += colors[colorIdx] + char + reset;
      } else {
        result += char;
      }
    }
    return result;
  }

  /** Fit string to exact width with ANSI-aware truncation/padding */
  private fitToWidth(str: string, width: number): string {
    const visLen = visibleWidth(str);
    if (visLen > width) {
      return this.truncateToWidth(str, width);
    }
    return str + " ".repeat(width - visLen);
  }

  /** Truncate string to width, preserving ANSI codes */
  private truncateToWidth(str: string, width: number): string {
    const ellipsis = "…";
    const maxWidth = Math.max(0, width - 1);
    let truncated = "";
    let currentWidth = 0;
    let inEscape = false;
    
    for (const char of str) {
      if (char === "\x1b") inEscape = true;
      if (inEscape) {
        truncated += char;
        if (char === "m") inEscape = false;
      } else if (currentWidth < maxWidth) {
        truncated += char;
        currentWidth++;
      }
    }
    
    if (visibleWidth(str) > width) {
      return truncated + ellipsis;
    }
    return truncated;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discover loaded counts by scanning filesystem.
 */
export function discoverLoadedCounts(): LoadedCounts {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const cwd = process.cwd();
  
  let contextFiles = 0;
  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  // Count AGENTS.md context files (check all locations pi-mono supports)
  const agentsMdPaths = [
    join(homeDir, ".pi", "agent", "AGENTS.md"),
    join(homeDir, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
    join(cwd, ".claude", "AGENTS.md"),
  ];
  
  for (const path of agentsMdPaths) {
    if (existsSync(path)) {
      contextFiles++;
    }
  }

  // Count extensions - both standalone .ts files and directories with index.ts
  const extensionDirs = [
    join(homeDir, ".pi", "agent", "extensions"),
    join(cwd, "extensions"),
    join(cwd, ".pi", "extensions"),
  ];
  
  const countedExtensions = new Set<string>();
  
  for (const dir of extensionDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          const stats = statSync(entryPath);
          
          if (stats.isDirectory()) {
            // Directory extension - check for index.ts or package.json
            if (existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "package.json"))) {
              if (!countedExtensions.has(entry)) {
                countedExtensions.add(entry);
                extensions++;
              }
            }
          } else if (entry.endsWith(".ts") && !entry.startsWith(".")) {
            // Standalone .ts file extension
            const name = basename(entry, ".ts");
            if (!countedExtensions.has(name)) {
              countedExtensions.add(name);
              extensions++;
            }
          }
        }
      } catch {}
    }
  }

  // Count skills
  const skillDirs = [
    join(homeDir, ".pi", "agent", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, "skills"),
  ];
  
  const countedSkills = new Set<string>();
  
  for (const dir of skillDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          try {
            if (statSync(entryPath).isDirectory()) {
              // Check for SKILL.md
              if (existsSync(join(entryPath, "SKILL.md"))) {
                if (!countedSkills.has(entry)) {
                  countedSkills.add(entry);
                  skills++;
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  // Count prompt templates (slash commands) - recursively find .md files
  const templateDirs = [
    join(homeDir, ".pi", "agent", "commands"),
    join(homeDir, ".claude", "commands"),
    join(cwd, ".pi", "commands"),
    join(cwd, ".claude", "commands"),
  ];
  
  const countedTemplates = new Set<string>();
  
  function countTemplatesInDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            // Recurse into subdirectories
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch {}
      }
    } catch {}
  }
  
  for (const dir of templateDirs) {
    countTemplatesInDir(dir);
  }

  return { contextFiles, extensions, skills, promptTemplates };
}

/**
 * Get recent sessions from the sessions directory.
 * pi-mono stores sessions in subdirectories: ~/.pi/agent/sessions/<project-path>/*.jsonl
 */
export function getRecentSessions(maxCount: number = 3): RecentSession[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  
  // Try multiple possible session directories (pi-mono uses ~/.pi/agent/sessions/)
  const sessionsDirs = [
    join(homeDir, ".pi", "agent", "sessions"),
    join(homeDir, ".pi", "sessions"),
  ];
  
  const sessions: { name: string; mtime: number }[] = [];
  
  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            // Recurse into subdirectories (project folders)
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            // Extract project name from parent directory
            const parentName = basename(dir);
            // Clean up the directory name (it's URL-encoded path like --Users-nicobailon-...)
            let projectName = parentName;
            if (parentName.startsWith("--")) {
              // Extract last path segment
              const parts = parentName.split("-").filter(p => p);
              projectName = parts[parts.length - 1] || parentName;
            }
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch {}
      }
    } catch {}
  }
  
  for (const sessionsDir of sessionsDirs) {
    scanDir(sessionsDir);
  }
  
  if (sessions.length === 0) return [];
  
  // Sort by modification time (newest first) and deduplicate by name
  sessions.sort((a, b) => b.mtime - a.mtime);
  
  const seen = new Set<string>();
  const uniqueSessions: typeof sessions = [];
  for (const s of sessions) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      uniqueSessions.push(s);
    }
  }

  // Format time ago
  const now = Date.now();
  return uniqueSessions.slice(0, maxCount).map(s => ({
    name: s.name.length > 20 ? s.name.slice(0, 17) + "…" : s.name,
    timeAgo: formatTimeAgo(now - s.mtime),
  }));
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
