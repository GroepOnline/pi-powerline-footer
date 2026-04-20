import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { matchHistoryEntries, readGlobalShellHistory, readProjectHistory } from "./history.ts";
import { createNativeCompletionAdapters } from "./native-completion.ts";
import type {
  CompletionRequest,
  ExtendedCompletionItem,
  GhostSuggestion,
  NativeCompletionAdapter,
} from "./types.ts";

interface TokenContext {
  line: string;
  cursorCol: number;
  beforeCursor: string;
  afterCursor: string;
  token: string;
  tokenStart: number;
  tokenEnd: number;
  tokenIndex: number;
  previousTokens: string[];
}

const GIT_SUBCOMMANDS = [
  "add", "bisect", "branch", "checkout", "cherry-pick", "clean", "clone", "commit", "diff", "fetch",
  "grep", "init", "log", "merge", "mv", "pull", "push", "rebase", "reset", "restore", "revert", "rm",
  "show", "stash", "status", "switch", "tag", "worktree",
];

let executableCachePath = "";
let executableCacheTime = 0;
let executableCache: string[] = [];

function tokenizeBeforeCursor(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function getTokenContext(line: string, cursorCol: number): TokenContext {
  const beforeCursor = line.slice(0, cursorCol);
  const afterCursor = line.slice(cursorCol);
  const tokens = tokenizeBeforeCursor(beforeCursor);

  let tokenStart = 0;
  for (let i = beforeCursor.length - 1; i >= 0; i -= 1) {
    const char = beforeCursor[i];
    if (char && /\s/.test(char)) {
      tokenStart = i + 1;
      break;
    }
  }

  let tokenEnd = cursorCol;
  for (let i = cursorCol; i < line.length; i += 1) {
    const char = line[i];
    if (char && /\s/.test(char)) break;
    tokenEnd = i + 1;
  }

  return {
    line,
    cursorCol,
    beforeCursor,
    afterCursor,
    token: line.slice(tokenStart, tokenEnd),
    tokenStart,
    tokenEnd,
    tokenIndex: Math.max(0, tokens.length - 1),
    previousTokens: tokens,
  };
}

function shellNameFromPath(shellPath: string): string {
  return basename(shellPath).toLowerCase();
}

function uniqueByReplacement(items: ExtendedCompletionItem[]): ExtendedCompletionItem[] {
  const best = new Map<string, ExtendedCompletionItem>();
  for (const item of items) {
    const key = `${item.startCol}:${item.endCol}:${item.replacement}`;
    const existing = best.get(key);
    if (!existing || item.score > existing.score) {
      best.set(key, item);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function pathBase(token: string, cwd: string): { dir: string; prefix: string; displayPrefix: string } {
  const expanded = token.startsWith("~/")
    ? join(process.env.HOME || "", token.slice(2))
    : token;

  const hasSlash = expanded.includes("/");
  if (!hasSlash) {
    return { dir: cwd, prefix: expanded, displayPrefix: "" };
  }

  const baseDir = expanded.endsWith("/") ? expanded.slice(0, -1) : dirname(expanded);
  const resolvedDir = isAbsolute(baseDir) ? baseDir : resolve(cwd, baseDir);
  const prefix = expanded.endsWith("/") ? "" : basename(expanded);
  const displayPrefix = token.endsWith("/") ? token : token.slice(0, Math.max(0, token.length - prefix.length));
  return { dir: resolvedDir, prefix, displayPrefix };
}

function escapeShellPath(value: string): string {
  return value.replace(/([\\\s"'`$&|;<>()[\]{}?!*])/g, "\\$1");
}

function getPathSuggestions(token: string, cwd: string): ExtendedCompletionItem[] {
  if (!token) return [];
  const { dir, prefix, displayPrefix } = pathBase(token, cwd);

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => prefix.length === 0 || entry.name.startsWith(prefix))
      .slice(0, 100);

    return entries.map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      const label = `${displayPrefix}${entry.name}${suffix}`;
      const replacement = `${displayPrefix}${escapeShellPath(entry.name)}${suffix}`;
      return {
        value: replacement,
        label,
        replacement,
        startCol: 0,
        endCol: 0,
        source: "path",
        score: 40 + (entry.isDirectory() ? 4 : 0),
      } satisfies ExtendedCompletionItem;
    });
  } catch {
    // Missing or unreadable directories should only remove this completion source.
    return [];
  }
}

function getExecutableSuggestions(token: string): ExtendedCompletionItem[] {
  const pathValue = process.env.PATH || "";
  const now = Date.now();
  if (pathValue !== executableCachePath || now - executableCacheTime > 60_000) {
    const found = new Set<string>();
    for (const dir of pathValue.split(":").filter(Boolean)) {
      try {
        for (const entry of readdirSync(dir)) {
          if (!entry || found.has(entry)) continue;
          found.add(entry);
        }
      } catch {
        // Ignore unreadable PATH directories and keep the rest of the cache usable.
      }
    }
    executableCachePath = pathValue;
    executableCacheTime = now;
    executableCache = [...found].sort();
  }

  return executableCache
    .filter((entry) => entry.startsWith(token))
    .slice(0, 100)
    .map((entry) => ({
      value: entry,
      label: entry,
      replacement: entry,
      startCol: 0,
      endCol: 0,
      source: "executable",
      score: 35,
    }));
}

function runGit(args: string[], cwd: string): string[] {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    // Git-aware completions are optional and should not break the main completion flow.
    return [];
  }
}

function getGitSuggestions(ctx: TokenContext, cwd: string): ExtendedCompletionItem[] {
  const tokens = ctx.previousTokens;
  if (tokens[0] !== "git") return [];

  if (ctx.tokenIndex <= 1) {
    return GIT_SUBCOMMANDS
      .filter((command) => command.startsWith(ctx.token))
      .map((command) => ({
        value: command,
        label: command,
        replacement: command,
        startCol: 0,
        endCol: 0,
        source: "git",
        score: 52,
      }));
  }

  const subcommand = tokens[1] ?? "";
  if (!["checkout", "switch", "merge", "rebase", "branch", "show", "diff"].includes(subcommand)) {
    return [];
  }

  const refs = [
    ...runGit(["branch", "--format=%(refname:short)"], cwd),
    ...runGit(["tag", "--list"], cwd),
  ];

  return [...new Set(refs)]
    .filter((ref) => ref.startsWith(ctx.token))
    .slice(0, 100)
    .map((ref) => ({
      value: ref,
      label: ref,
      replacement: ref,
      startCol: 0,
      endCol: 0,
      source: "git",
      score: 50,
    }));
}

function canUseHistorySuggestion(ctx: TokenContext): boolean {
  return ctx.cursorCol === ctx.line.length && ctx.line.trim().length > 0;
}

function toHistoryItems(values: string[], source: "project-history" | "global-history"): ExtendedCompletionItem[] {
  const baseScore = source === "project-history" ? 100 : 90;
  return values.map((value, index) => ({
    value,
    label: value,
    replacement: value,
    startCol: 0,
    endCol: value.length,
    source,
    score: baseScore - index,
  }));
}

function withRange(items: ExtendedCompletionItem[], startCol: number, endCol: number): ExtendedCompletionItem[] {
  return items.map((item) => ({ ...item, startCol, endCol }));
}

export class BashCompletionEngine {
  private readonly adapters: NativeCompletionAdapter[] = createNativeCompletionAdapters();

  async getGhostSuggestion(line: string, cwd: string, shellPath: string, signal: AbortSignal): Promise<GhostSuggestion | null> {
    const ctx = getTokenContext(line, line.length);
    if (!canUseHistorySuggestion(ctx)) return null;

    const projectHistory = matchHistoryEntries(
      readProjectHistory(cwd).map((entry) => entry.command),
      line,
      10,
    );
    if (projectHistory.length > 0) {
      return { value: projectHistory[0]!, source: "project-history" };
    }

    const globalHistory = matchHistoryEntries(readGlobalShellHistory(shellPath), line, 10);
    if (globalHistory.length > 0) {
      return { value: globalHistory[0]!, source: "global-history" };
    }

    const native = withRange(
      await this.getNativeSuggestions({ line, cursorCol: line.length, cwd, shellPath, signal }),
      ctx.tokenStart,
      ctx.tokenEnd,
    );
    for (const item of native) {
      const value = this.buildInlineSuggestionValue(line, item);
      if (value) {
        return { value, source: item.source };
      }
    }

    const deterministic = this.getDeterministicInlineSuggestions(ctx, cwd);
    for (const item of deterministic) {
      const value = this.buildInlineSuggestionValue(line, item);
      if (value) {
        return { value, source: item.source };
      }
    }

    return null;
  }

  private getDeterministicInlineSuggestions(ctx: TokenContext, cwd: string): ExtendedCompletionItem[] {
    const items: ExtendedCompletionItem[] = [];
    items.push(...withRange(getGitSuggestions(ctx, cwd), ctx.tokenStart, ctx.tokenEnd));
    items.push(...withRange(getPathSuggestions(ctx.token, cwd), ctx.tokenStart, ctx.tokenEnd));

    if (ctx.tokenIndex === 0) {
      items.push(...withRange(getExecutableSuggestions(ctx.token), ctx.tokenStart, ctx.tokenEnd));
    }

    return uniqueByReplacement(items);
  }

  private buildInlineSuggestionValue(line: string, item: ExtendedCompletionItem): string | null {
    const value = line.slice(0, item.startCol) + item.replacement + line.slice(item.endCol);
    if (!value.startsWith(line) || value === line) {
      return null;
    }
    return value;
  }

  async getDropdownSuggestions(request: CompletionRequest): Promise<ExtendedCompletionItem[]> {
    const ctx = getTokenContext(request.line, request.cursorCol);
    const items: ExtendedCompletionItem[] = [];

    if (canUseHistorySuggestion(ctx)) {
      items.push(
        ...toHistoryItems(
          matchHistoryEntries(readProjectHistory(request.cwd).map((entry) => entry.command), request.line, 5),
          "project-history",
        ),
        ...toHistoryItems(matchHistoryEntries(readGlobalShellHistory(request.shellPath), request.line, 5), "global-history"),
      );
    }

    const native = await this.getNativeSuggestions(request);
    items.push(...withRange(native, ctx.tokenStart, ctx.tokenEnd));

    const git = withRange(getGitSuggestions(ctx, request.cwd), ctx.tokenStart, ctx.tokenEnd);
    items.push(...git);

    const path = withRange(getPathSuggestions(ctx.token, request.cwd), ctx.tokenStart, ctx.tokenEnd);
    items.push(...path);

    if (ctx.tokenIndex === 0) {
      items.push(...withRange(getExecutableSuggestions(ctx.token), ctx.tokenStart, ctx.tokenEnd));
    }

    return uniqueByReplacement(items).slice(0, 20);
  }

  private async getNativeSuggestions(request: CompletionRequest): Promise<ExtendedCompletionItem[]> {
    const shellName = shellNameFromPath(request.shellPath);
    const adapter = this.adapters.find((candidate) => candidate.shellNames.some((name) => shellName.includes(name)));
    if (!adapter) return [];
    try {
      return await adapter.getCompletions(request);
    } catch (error) {
      if ((error as Error).message !== "aborted") {
        console.debug(`[powerline-footer] Native completion failed for ${shellName}:`, error);
      }
      return [];
    }
  }
}

export class BashAutocompleteProvider implements AutocompleteProvider {
  private readonly engine: BashCompletionEngine;
  private readonly getShellPath: () => string;
  private readonly getCwd: () => string;

  constructor(engine: BashCompletionEngine, getShellPath: () => string, getCwd: () => string) {
    this.engine = engine;
    this.getShellPath = getShellPath;
    this.getCwd = getCwd;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] || "";
    const cwd = this.getCwd();
    const shellPath = this.getShellPath();
    const items = await this.engine.getDropdownSuggestions({
      line,
      cursorCol,
      cwd,
      shellPath,
      signal: options.signal,
    });

    if (items.length === 0) return null;

    const ctx = getTokenContext(line, cursorCol);
    const prefix = ctx.token || line;
    return {
      prefix,
      items: items as unknown as AutocompleteItem[],
    };
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem): {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
  } {
    const extended = item as ExtendedCompletionItem;
    const currentLine = lines[cursorLine] || "";
    const startCol = Math.max(0, Math.min(extended.startCol, currentLine.length));
    const endCol = Math.max(startCol, Math.min(extended.endCol, currentLine.length));
    const nextLine = currentLine.slice(0, startCol) + extended.replacement + currentLine.slice(endCol);
    const nextLines = [...lines];
    nextLines[cursorLine] = nextLine;
    return {
      lines: nextLines,
      cursorLine,
      cursorCol: startCol + extended.replacement.length,
    };
  }

  shouldTriggerFileCompletion(): boolean {
    return true;
  }
}

export class ModeAwareAutocompleteProvider implements AutocompleteProvider {
  private readonly defaultProvider: AutocompleteProvider | undefined;
  private readonly bashProvider: AutocompleteProvider;
  private readonly isBashModeActive: () => boolean;

  constructor(
    defaultProvider: AutocompleteProvider | undefined,
    bashProvider: AutocompleteProvider,
    isBashModeActive: () => boolean,
  ) {
    this.defaultProvider = defaultProvider;
    this.bashProvider = bashProvider;
    this.isBashModeActive = isBashModeActive;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    if (this.isBashModeActive()) {
      return this.bashProvider.getSuggestions(lines, cursorLine, cursorCol, options);
    }
    return this.defaultProvider?.getSuggestions(lines, cursorLine, cursorCol, options) ?? null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
    if (this.isBashModeActive()) {
      return this.bashProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    }
    if (!this.defaultProvider) {
      return { lines, cursorLine, cursorCol };
    }
    return this.defaultProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    if (this.isBashModeActive()) {
      return (this.bashProvider as AutocompleteProvider & { shouldTriggerFileCompletion?: typeof this.shouldTriggerFileCompletion })
        .shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    }
    return (this.defaultProvider as AutocompleteProvider & { shouldTriggerFileCompletion?: typeof this.shouldTriggerFileCompletion })
      ?.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }
}
