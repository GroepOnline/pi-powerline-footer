import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appendProjectHistory, readGlobalShellHistory } from "../bash-mode/history.ts";
import { BashTranscriptStore } from "../bash-mode/transcript.ts";
import { BashCompletionEngine } from "../bash-mode/completion.ts";
import { ManagedShellSession } from "../bash-mode/shell-session.ts";
import type { ExtendedCompletionItem } from "../bash-mode/types.ts";

test("project history is stored newest-first and global zsh history parses histfile format", () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-history-"));
  const histfile = join(cwd, ".zsh_history");
  process.env.HISTFILE = histfile;

  appendProjectHistory(cwd, "git status", cwd);
  appendProjectHistory(cwd, "git stash", cwd);
  appendProjectHistory(cwd, "git status", cwd);

  writeFileSync(histfile, [
    ": 1711111111:0;git fetch",
    ": 1711111112:0;git pull",
    "plain-command",
    "",
  ].join("\n"));

  const global = readGlobalShellHistory("/bin/zsh");
  assert.deepEqual(global, ["plain-command", "git pull", "git fetch"]);
});

test("transcript store truncates oldest commands at command boundaries", () => {
  const store = new BashTranscriptStore({ transcriptMaxLines: 3, transcriptMaxBytes: 1024 });
  store.startCommand("a", "echo one", "/tmp");
  store.appendOutput("a", "line-1\nline-2");
  store.finishCommand("a", 0);

  store.startCommand("b", "echo two", "/tmp");
  store.appendOutput("b", "line-3\nline-4");
  store.finishCommand("b", 0);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.commands.length, 1);
  assert.equal(snapshot.commands[0]?.id, "b");
  assert.equal(snapshot.truncatedCommands, 1);
});

test("transcript store keeps the active command even when it alone exceeds limits", () => {
  const store = new BashTranscriptStore({ transcriptMaxLines: 3, transcriptMaxBytes: 1024 });
  store.startCommand("a", "echo big", "/tmp");
  store.appendOutput("a", "1\n2\n3\n4");

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.commands.length, 1);
  assert.equal(snapshot.commands[0]?.id, "a");
  assert.deepEqual(snapshot.commands[0]?.output, ["1", "2", "3", "4"]);
});

test("completion engine ranks project history above global history and deterministic sources", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-completion-"));
  const binDir = join(cwd, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "gitish"), "#!/bin/sh\n", { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH || ""}`;

  const histfile = join(cwd, ".zsh_history");
  process.env.HISTFILE = histfile;
  writeFileSync(histfile, ": 1711111111:0;git switch\n");

  appendProjectHistory(cwd, "git status", cwd);
  appendProjectHistory(cwd, "git stash", cwd);

  const engine = new BashCompletionEngine() as BashCompletionEngine & {
    getNativeSuggestions: (request: any) => Promise<ExtendedCompletionItem[]>;
  };
  engine.getNativeSuggestions = async () => [{
    value: "status",
    label: "status",
    replacement: "status",
    startCol: 0,
    endCol: 0,
    source: "native",
    score: 60,
  }];

  const items = await engine.getDropdownSuggestions({
    line: "git st",
    cursorCol: 6,
    cwd,
    shellPath: "/bin/zsh",
    signal: new AbortController().signal,
  });

  assert.equal(items[0]?.replacement, "git stash");
  assert.equal(items[0]?.source, "project-history");
  assert.ok(items.some((item) => item.source === "native"));
  assert.ok(items.some((item) => item.source === "git"));
});

test("ghost suggestion prefers project history over global history", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-ghost-"));
  const histfile = join(cwd, ".zsh_history");
  process.env.HISTFILE = histfile;
  writeFileSync(histfile, ": 1711111111:0;git switch\n");
  appendProjectHistory(cwd, "git status", cwd);
  appendProjectHistory(cwd, "git stash", cwd);

  const engine = new BashCompletionEngine();
  const suggestion = await engine.getGhostSuggestion(
    "git st",
    cwd,
    "/bin/zsh",
    new AbortController().signal,
  );

  assert.equal(suggestion?.value, "git stash");
  assert.equal(suggestion?.source, "project-history");
});

test("ghost suggestion can extend the current token from deterministic path completions", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-inline-ghost-"));
  mkdirSync(join(cwd, "dev"), { recursive: true });
  mkdirSync(join(cwd, "My Folder"), { recursive: true });

  const engine = new BashCompletionEngine();
  const suggestion = await engine.getGhostSuggestion(
    "cd d",
    cwd,
    "/bin/sh",
    new AbortController().signal,
  );
  const escapedSuggestion = await engine.getGhostSuggestion(
    "cd M",
    cwd,
    "/bin/sh",
    new AbortController().signal,
  );

  assert.equal(suggestion?.value, "cd dev/");
  assert.equal(suggestion?.source, "path");
  assert.equal(escapedSuggestion?.value, "cd My\\ Folder/");
  assert.equal(escapedSuggestion?.source, "path");
});

test("ghost suggestion uses shell-native completions before deterministic fallback", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-native-ghost-"));
  mkdirSync(join(cwd, "dev"), { recursive: true });

  const engine = new BashCompletionEngine() as BashCompletionEngine & {
    getNativeSuggestions: (request: any) => Promise<ExtendedCompletionItem[]>;
  };
  engine.getNativeSuggestions = async () => [{
    value: "develop",
    label: "develop",
    replacement: "develop",
    startCol: 0,
    endCol: 0,
    source: "native",
    score: 99,
  }];

  const suggestion = await engine.getGhostSuggestion(
    "cd d",
    cwd,
    "/bin/zsh",
    new AbortController().signal,
  );

  assert.equal(suggestion?.value, "cd develop");
  assert.equal(suggestion?.source, "native");
});

test("zsh shell native completion keeps directory suffixes for escaped paths", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-zsh-native-path-"));
  const histfile = join(cwd, ".zsh_history");
  process.env.HISTFILE = histfile;
  writeFileSync(histfile, "");
  mkdirSync(join(cwd, "My Folder"), { recursive: true });

  const engine = new BashCompletionEngine();
  const suggestion = await engine.getGhostSuggestion(
    "cd M",
    cwd,
    "/bin/zsh",
    new AbortController().signal,
  );

  assert.equal(suggestion?.value, "cd My\\ Folder/");
  assert.equal(suggestion?.source, "native");
});

test("bash shell native completion does not override path completion in argument position", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-bash-native-path-"));
  mkdirSync(join(cwd, "devdir"), { recursive: true });

  const engine = new BashCompletionEngine();
  const suggestion = await engine.getGhostSuggestion(
    "cd d",
    cwd,
    "/bin/bash",
    new AbortController().signal,
  );

  assert.equal(suggestion?.value, "cd devdir/");
  assert.equal(suggestion?.source, "native");
});

test("managed shell session preserves cwd changes across commands", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-shell-"));
  const childDir = join(cwd, "child");
  mkdirSync(childDir, { recursive: true });
  const store = new BashTranscriptStore({ transcriptMaxLines: 100, transcriptMaxBytes: 64 * 1024 });
  const session = new ManagedShellSession("/bin/zsh", cwd, store, () => {}, () => {});

  try {
    await session.ensureReady();
    await session.runCommand(`cd ${childDir}`);
    const waitForCommand = async () => {
      const start = Date.now();
      while (session.state.running && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(session.state.running, false);
    };

    await waitForCommand();
    assert.equal(session.state.cwd, childDir);

    await session.runCommand("pwd");
    await waitForCommand();

    const snapshot = store.getSnapshot();
    const lastCommand = snapshot.commands[snapshot.commands.length - 1];
    assert.ok(lastCommand?.output.includes(childDir));
  } finally {
    session.dispose();
  }
});

test("managed shell session recovers cleanly after interrupt", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "powerline-shell-interrupt-"));
  const store = new BashTranscriptStore({ transcriptMaxLines: 100, transcriptMaxBytes: 64 * 1024 });
  const session = new ManagedShellSession("/bin/zsh", cwd, store, () => {}, () => {});

  const waitForCommand = async () => {
    const start = Date.now();
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(session.state.running, false);
  };

  try {
    await session.ensureReady();
    await session.runCommand("sleep 5");
    await new Promise((resolve) => setTimeout(resolve, 100));
    session.interrupt();
    await waitForCommand();

    const interruptedCommand = store.getSnapshot().commands[0];
    assert.equal(interruptedCommand?.exitCode, 130);

    await session.runCommand("printf 'after\\n'");
    await waitForCommand();

    const snapshot = store.getSnapshot();
    const lastCommand = snapshot.commands[snapshot.commands.length - 1];
    assert.equal(lastCommand?.command, "printf 'after\\n'");
    assert.equal(lastCommand?.exitCode, 0);
    assert.ok(lastCommand?.output.includes("after"));
  } finally {
    session.dispose();
  }
});

test("bash editor autocomplete trigger keeps the editor instance binding", async () => {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@mariozechner");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-tui"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
    },
  ];

  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
    }
  }

  try {
    const { BashModeEditor } = await import("../bash-mode/editor.ts");
    const calls: Array<{ force: boolean; explicitTab: boolean }> = [];
    (BashModeEditor.prototype as Record<string, unknown>)["triggerBashAutocomplete"].call({
      requestAutocomplete(options: { force: boolean; explicitTab: boolean }) {
        calls.push(options);
      },
    });
    assert.deepEqual(calls, [{ force: false, explicitTab: false }]);
  } finally {
    for (const { link } of links.reverse()) {
      if (existsSync(link)) {
        rmSync(link, { recursive: true, force: true });
      }
    }
    const rootNodeModules = dirname(nodeModulesDir);
    if (existsSync(rootNodeModules)) {
      rmSync(rootNodeModules, { recursive: true, force: true });
    }
  }
});

test("bash editor dismiss clears autocomplete when mode turns off", async () => {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@mariozechner");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-tui"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
    },
  ];

  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
    }
  }

  try {
    const { BashModeEditor } = await import("../bash-mode/editor.ts");
    let aborted = false;
    let cancelled = false;
    let rendered = false;
    const fakeAbort = { abort() { aborted = true; } };
    const fakeEditor = {
      historyIndex: 7,
      shellHistoryIndex: 2,
      shellHistoryItems: ["git status"],
      shellHistoryDraft: "git st",
      ghostAbort: fakeAbort,
      ghost: { value: "git status", source: "project-history" },
      clearGhostSuggestion() {
        this.ghostAbort?.abort();
        this.ghostAbort = null;
        this.ghost = null;
      },
      cancelAutocomplete() {
        cancelled = true;
      },
      tui: {
        requestRender() {
          rendered = true;
        },
      },
    };

    (BashModeEditor.prototype as Record<string, unknown>)["dismissBashModeUi"].call(fakeEditor);

    assert.equal(aborted, true);
    assert.equal(cancelled, true);
    assert.equal(rendered, true);
    assert.equal(fakeEditor.historyIndex, 7);
    assert.equal(fakeEditor.shellHistoryIndex, -1);
  } finally {
    for (const { link } of links.reverse()) {
      if (existsSync(link)) {
        rmSync(link, { recursive: true, force: true });
      }
    }
    const rootNodeModules = dirname(nodeModulesDir);
    if (existsSync(rootNodeModules)) {
      rmSync(rootNodeModules, { recursive: true, force: true });
    }
  }
});

test("bash editor shell history state does not clobber the base prompt history index", async () => {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@mariozechner");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-tui"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
    },
  ];

  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
    }
  }

  try {
    const { BashModeEditor } = await import("../bash-mode/editor.ts");
    const fakeEditor = {
      historyIndex: 5,
      shellHistoryIndex: -1,
      shellHistoryItems: [],
      shellHistoryDraft: "",
      ghostAbort: null,
      ghost: null,
      optionsRef: {
        getHistoryEntries: () => ["git stash", "git status"],
        onNotify: () => {},
      },
      getExpandedText() {
        return "git st";
      },
      setText() {},
      clearGhostSuggestion() {},
      scheduleGhostUpdate() {},
    };

    (BashModeEditor.prototype as Record<string, unknown>)["navigateShellHistory"].call(fakeEditor, -1);

    assert.equal(fakeEditor.historyIndex, 5);
    assert.equal(fakeEditor.shellHistoryIndex, 0);
  } finally {
    for (const { link } of links.reverse()) {
      if (existsSync(link)) {
        rmSync(link, { recursive: true, force: true });
      }
    }
    const rootNodeModules = dirname(nodeModulesDir);
    if (existsSync(rootNodeModules)) {
      rmSync(rootNodeModules, { recursive: true, force: true });
    }
  }
});

test("bash editor escape exits bash mode", async () => {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@mariozechner");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-tui"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
    },
  ];

  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
    }
  }

  try {
    const { BashModeEditor } = await import("../bash-mode/editor.ts");
    let exited = false;
    let interrupted = false;

    (BashModeEditor.prototype as Record<string, unknown>)["handleInput"].call({
      optionsRef: {
        isBashModeActive: () => true,
        onExitBashMode: () => {
          exited = true;
        },
        isShellRunning: () => false,
        onInterrupt: () => {
          interrupted = true;
        },
      },
      keybindingsRef: {
        matches(data: string, id: string) {
          return data === "escape" && id === "app.interrupt";
        },
      },
    }, "escape");

    assert.equal(exited, true);
    assert.equal(interrupted, false);
  } finally {
    for (const { link } of links.reverse()) {
      if (existsSync(link)) {
        rmSync(link, { recursive: true, force: true });
      }
    }
    const rootNodeModules = dirname(nodeModulesDir);
    if (existsSync(rootNodeModules)) {
      rmSync(rootNodeModules, { recursive: true, force: true });
    }
  }
});

test("bash editor enter does not accept ghost text while a shell command is running", async () => {
  const nodeModulesDir = join(process.cwd(), "node_modules", "@mariozechner");
  mkdirSync(nodeModulesDir, { recursive: true });
  const links = [
    {
      link: join(nodeModulesDir, "pi-coding-agent"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
    },
    {
      link: join(nodeModulesDir, "pi-tui"),
      target: "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
    },
  ];

  for (const { link, target } of links) {
    if (!existsSync(link)) {
      symlinkSync(target, link);
    }
  }

  try {
    const { BashModeEditor } = await import("../bash-mode/editor.ts");
    let warned = false;
    let submitted = false;

    (BashModeEditor.prototype as Record<string, unknown>)["handleInput"].call({
      ghost: { value: "git status", source: "project-history" },
      optionsRef: {
        isBashModeActive: () => true,
        isShellRunning: () => true,
        onExitBashMode: () => {},
        onInterrupt: () => {},
        onSubmitCommand: () => {
          submitted = true;
        },
        onNotify: (message: string) => {
          warned = message === "Shell command already running";
        },
      },
      keybindingsRef: {
        matches(_data: string, id: string) {
          return id === "tui.input.submit";
        },
      },
      getExpandedText() {
        return "git st";
      },
      isShowingAutocomplete() {
        return false;
      },
      acceptGhostSuggestion() {
        throw new Error("ghost should not be accepted while running");
      },
    }, "enter");

    assert.equal(warned, true);
    assert.equal(submitted, false);
  } finally {
    for (const { link } of links.reverse()) {
      if (existsSync(link)) {
        rmSync(link, { recursive: true, force: true });
      }
    }
    const rootNodeModules = dirname(nodeModulesDir);
    if (existsSync(rootNodeModules)) {
      rmSync(rootNodeModules, { recursive: true, force: true });
    }
  }
});
