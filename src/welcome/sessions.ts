import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";
import { getAgentSessionDirs } from "../paths/agent-dirs.ts";
import { logDiscoveryError } from "./discovery.ts";
import { formatTimeAgo } from "./format.ts";
import type { RecentSession } from "./types.ts";

const SESSION_HEADER_READ_BYTES = 8192;

/**
 * Get recent sessions from the sessions directory.
 */
function readSessionHeaderProjectName(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer
      .toString("utf8", 0, bytesRead)
      .split(/\r?\n/, 1)[0]
      ?.trim();
    if (!firstLine) return null;

    const header: unknown = JSON.parse(firstLine);
    if (typeof header !== "object" || header === null || Array.isArray(header))
      return null;

    const cwd = Reflect.get(header, "cwd");
    if (typeof cwd !== "string" || cwd.trim().length === 0) return null;

    return basename(cwd) || cwd;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function sessionProjectNameFromDirectory(dir: string): string {
  const parentName = basename(dir);
  if (!parentName.startsWith("--")) {
    return parentName;
  }

  const parts = parentName.split("-").filter((p) => p);
  return parts[parts.length - 1] || parentName;
}

export function getRecentSessions(maxCount: number = 3): RecentSession[] {
  const sessionsDirs = getAgentSessionDirs();

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
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            const projectName =
              readSessionHeaderProjectName(entryPath) ??
              sessionProjectNameFromDirectory(dir);
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch (error) {
          logDiscoveryError(
            `Failed to inspect session entry ${entryPath}`,
            error,
          );
        }
      }
    } catch (error) {
      logDiscoveryError(`Failed to scan sessions dir ${dir}`, error);
    }
  }

  for (const sessionsDir of sessionsDirs) {
    scanDir(sessionsDir);
  }

  if (sessions.length === 0) return [];

  sessions.sort((a, b) => b.mtime - a.mtime);

  const seen = new Set<string>();
  const uniqueSessions: typeof sessions = [];
  for (const s of sessions) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      uniqueSessions.push(s);
    }
  }

  const now = Date.now();
  return uniqueSessions.slice(0, maxCount).map((s) => ({
    name: s.name.length > 20 ? s.name.slice(0, 17) + "…" : s.name,
    timeAgo: formatTimeAgo(now - s.mtime),
  }));
}
