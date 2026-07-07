import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLoadedCounts, getRecentSessions } from "../welcome.ts";

test("discoverLoadedCounts ignores dangling skill symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "powerline-welcome-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const skillsDir = join(home, ".pi", "agent", "skills");
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const originalDebug = console.debug;
  const debugCalls: unknown[][] = [];

  mkdirSync(join(skillsDir, "valid-skill"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(skillsDir, "valid-skill", "SKILL.md"), "# Valid skill\n");
  symlinkSync(join(root, "missing-skill"), join(skillsDir, "pi-intercom"), "dir");

  console.debug = (...args: unknown[]) => {
    debugCalls.push(args);
  };

  try {
    process.env.HOME = home;
    process.chdir(project);

    assert.equal(discoverLoadedCounts().skills, 1);
    assert.deepEqual(debugCalls, []);
  } finally {
    console.debug = originalDebug;
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function withTemporaryHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "powerline-welcome-home-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = home;
    run(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

test("getRecentSessions prefers cwd basename from session header", () => {
  withTemporaryHome((home) => {
    const sessionsDir = join(home, ".pi", "agent", "sessions", "--Users-nico-dev-encoded-name--");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "session.jsonl"), JSON.stringify({ cwd: "/Users/nico/dev/my-dashed-project" }) + "\n");

    assert.equal(getRecentSessions(1)[0]?.name, "my-dashed-project");
  });
});

test("getRecentSessions falls back to encoded directory when header cwd is unusable", () => {
  withTemporaryHome((home) => {
    const root = join(home, ".pi", "agent", "sessions");
    const cases = [
      ["invalid-json", "not-json\n"],
      ["missing-cwd", JSON.stringify({ type: "session" }) + "\n"],
      ["non-string-cwd", JSON.stringify({ cwd: 123 }) + "\n"],
    ];

    for (const [name, content] of cases) {
      const sessionsDir = join(root, `--Users-nico-dev-${name}--`);
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, "session.jsonl"), content);
    }

    const names = getRecentSessions(10).map((session) => session.name);
    assert.ok(names.includes("json"));
    assert.ok(names.includes("cwd"));
  });
});
