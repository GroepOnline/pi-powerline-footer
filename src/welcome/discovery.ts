import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { getAgentPath, getHomeDir } from "../paths/paths.ts";
import type { LoadedCounts } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Discovery functions
// ═══════════════════════════════════════════════════════════════════════════

const loggedDiscoveryErrors = new Set<string>();

export function logDiscoveryError(scope: string, error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const key = `${scope}:${message}`;
  if (loggedDiscoveryErrors.has(key)) {
    return;
  }

  loggedDiscoveryErrors.add(key);
  if (loggedDiscoveryErrors.size > 500) {
    loggedDiscoveryErrors.clear();
  }

  console.debug(`[powerline-welcome] ${scope}:`, error);
}

/**
 * Discover loaded counts by scanning filesystem.
 */
export function discoverLoadedCounts(): LoadedCounts {
  const homeDir = getHomeDir();
  const cwd = process.cwd();

  let contextFiles = 0;
  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  const agentsMdPaths = [
    getAgentPath("AGENTS.md"),
    join(homeDir, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
    join(cwd, ".claude", "AGENTS.md"),
  ];

  for (const path of agentsMdPaths) {
    if (existsSync(path)) contextFiles++;
  }

  const extensionDirs = [
    getAgentPath("extensions"),
    join(cwd, "extensions"),
    join(cwd, ".pi", "extensions"),
  ];

  const countedExtensions = new Set<string>();

  const settingsPaths = [
    getAgentPath("settings.json"),
    join(cwd, ".pi", "settings.json"),
  ];

  for (const settingsPath of settingsPaths) {
    if (!existsSync(settingsPath)) {
      continue;
    }

    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      let packages: unknown = null;
      if (
        typeof settings === "object" &&
        settings !== null &&
        !Array.isArray(settings)
      ) {
        packages = (settings as { packages?: unknown }).packages;
      }

      if (Array.isArray(packages)) {
        for (const pkg of packages) {
          let source: unknown = null;
          let extensionsFilter: unknown = null;

          if (typeof pkg === "string") {
            source = pkg;
          } else if (
            typeof pkg === "object" &&
            pkg !== null &&
            !Array.isArray(pkg)
          ) {
            source = (pkg as { source?: unknown }).source;
            extensionsFilter = (pkg as { extensions?: unknown }).extensions;
          }

          if (typeof source !== "string") {
            continue;
          }

          const normalizedSource = source.trim();
          if (!normalizedSource.startsWith("npm:")) {
            continue;
          }

          if (
            Array.isArray(extensionsFilter) &&
            extensionsFilter.length === 0
          ) {
            continue;
          }

          const body = normalizedSource.slice(4);
          const versionIndex = body.lastIndexOf("@");
          const name = versionIndex > 0 ? body.slice(0, versionIndex) : body;
          if (!name || countedExtensions.has(name)) {
            continue;
          }

          countedExtensions.add(name);
          extensions++;
        }
      }
    } catch (error) {
      logDiscoveryError(`Failed to read settings at ${settingsPath}`, error);
    }
  }

  for (const dir of extensionDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);

          try {
            const stats = statSync(entryPath);

            if (stats.isDirectory()) {
              if (
                existsSync(join(entryPath, "index.ts")) ||
                existsSync(join(entryPath, "index.js")) ||
                existsSync(join(entryPath, "package.json"))
              ) {
                if (!countedExtensions.has(entry)) {
                  countedExtensions.add(entry);
                  extensions++;
                }
              }
            } else if (
              (entry.endsWith(".ts") || entry.endsWith(".js")) &&
              !entry.startsWith(".")
            ) {
              const ext = entry.endsWith(".ts") ? ".ts" : ".js";
              const name = basename(entry, ext);
              if (!countedExtensions.has(name)) {
                countedExtensions.add(name);
                extensions++;
              }
            }
          } catch (error) {
            logDiscoveryError(
              `Failed to inspect extension entry ${entryPath}`,
              error,
            );
          }
        }
      } catch (error) {
        logDiscoveryError(`Failed to scan extensions dir ${dir}`, error);
      }
    }
  }

  const skillDirs = [
    getAgentPath("skills"),
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
              if (existsSync(join(entryPath, "SKILL.md"))) {
                if (!countedSkills.has(entry)) {
                  countedSkills.add(entry);
                  skills++;
                }
              }
            }
          } catch (error) {
            logDiscoveryError(
              `Failed to inspect skill entry ${entryPath}`,
              error,
            );
          }
        }
      } catch (error) {
        logDiscoveryError(`Failed to scan skills dir ${dir}`, error);
      }
    }
  }

  const templateDirs = [
    getAgentPath("commands"),
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
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch (error) {
          logDiscoveryError(
            `Failed to inspect prompt template entry ${entryPath}`,
            error,
          );
        }
      }
    } catch (error) {
      logDiscoveryError(`Failed to scan prompt template dir ${dir}`, error);
    }
  }

  for (const dir of templateDirs) {
    countTemplatesInDir(dir);
  }

  return { contextFiles, extensions, skills, promptTemplates };
}
