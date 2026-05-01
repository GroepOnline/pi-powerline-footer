import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEYBINDINGS } from "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/keybindings.js";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

const powerlineShortcutKeys = new Set([
  "stashHistory",
  "copyEditor",
  "cutEditor",
  "jumpPreviousUserMessage",
  "jumpNextUserMessage",
  "jumpPreviousLlmMessage",
  "jumpNextLlmMessage",
  "jumpChatBottom",
]);

function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.trim().toLowerCase().split("+");
  if (parts.length <= 1) return parts[0] ?? "";

  const modifierRank = new Map(["ctrl", "alt", "shift"].map((modifier, index) => [modifier, index]));
  return [
    ...parts.slice(0, -1).sort((a, b) => (modifierRank.get(a) ?? 99) - (modifierRank.get(b) ?? 99)),
    parts[parts.length - 1],
  ].join("+");
}

function powerlineDefaults(): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const match of source.matchAll(/^  ([a-zA-Z0-9]+): "([^"]+)",?$/gm)) {
    const key = match[1];
    const value = match[2];
    if (key && value && powerlineShortcutKeys.has(key)) {
      defaults.set(key, value);
    }
  }
  return defaults;
}

test("chat jump shortcuts are configurable and route through fixed editor scrolling", () => {
  const defaults = powerlineDefaults();
  assert.equal(defaults.get("jumpPreviousUserMessage"), "ctrl+shift+u");
  assert.equal(defaults.get("jumpNextUserMessage"), "ctrl+shift+i");
  assert.equal(defaults.get("jumpPreviousLlmMessage"), "ctrl+alt+<");
  assert.equal(defaults.get("jumpNextLlmMessage"), "ctrl+alt+>");
  assert.equal(defaults.get("jumpChatBottom"), "ctrl+shift+g");
  assert.match(source, /const CHAT_JUMP_SHORTCUTS:/);
  assert.match(source, /shortcutKey: "jumpPreviousUserMessage"/);
  assert.match(source, /shortcutKey: "jumpNextUserMessage"/);
  assert.match(source, /shortcutKey: "jumpPreviousLlmMessage"/);
  assert.match(source, /shortcutKey: "jumpNextLlmMessage"/);
  assert.match(source, /shortcutKey: "jumpChatBottom"/);
  assert.match(source, /pi\.registerShortcut\(resolvedShortcuts\[shortcutKey\]/);
  assert.match(source, /function collectChatMessageStartLines\(role: ChatJumpRole\): number\[\]/);
  assert.match(source, /componentName === "UserMessageComponent"/);
  assert.match(source, /componentName === "SkillInvocationMessageComponent"/);
  assert.match(source, /componentName === "AssistantMessageComponent"/);
  assert.match(source, /fixedEditorCompositor\.jumpToPreviousRootTarget\(targets\)/);
  assert.match(source, /fixedEditorCompositor\.jumpToNextRootTarget\(targets\)/);
  assert.match(source, /fixedEditorCompositor\.jumpToRootBottom\(\)/);
  assert.match(source, /function getChatJumpShortcutAction\(data: string\): ChatJumpShortcutAction \| null/);
  assert.match(source, /jumpToChatMessage\(ctx, action\.action\.role, action\.action\.direction\)/);
});

test("powerline shortcut defaults do not claim reserved Pi shortcuts", () => {
  const reservedKeys = new Map<string, string>();
  for (const [id, definition] of Object.entries(KEYBINDINGS)) {
    const keys = definition.defaultKeys === undefined
      ? []
      : Array.isArray(definition.defaultKeys)
        ? definition.defaultKeys
        : [definition.defaultKeys];
    for (const key of keys) {
      reservedKeys.set(normalizeShortcut(key), id);
    }
  }

  for (const [name, shortcut] of powerlineDefaults()) {
    const conflict = reservedKeys.get(normalizeShortcut(shortcut));
    assert.equal(conflict, undefined, `${name} default ${shortcut} conflicts with ${conflict}`);
  }
});

test("powerline fallback routing rejects reserved Pi shortcut defaults", () => {
  assert.doesNotMatch(source, /KeybindingsManager/);
  assert.match(source, /TUI_KEYBINDINGS/);
  assert.match(source, /const APP_RESERVED_SHORTCUTS = \[/);
  assert.match(source, /"alt\+enter"/);
  assert.match(source, /"alt\+up"/);
  assert.match(source, /"alt\+down"/);
  assert.match(source, /"ctrl\+s"/);
  assert.match(source, /"shift\+l"/);
  assert.match(source, /for \(const definition of Object\.values\(TUI_KEYBINDINGS\)\)/);
  assert.doesNotMatch(source, /RESERVED_TUI_KEYBINDING_IDS/);
  assert.match(source, /const EXTRA_RESERVED_SHORTCUTS = \["alt\+s"\] as const/);
  assert.match(source, /const SHORTCUT_MODIFIER_ORDER = \["ctrl", "alt", "shift"\] as const/);
  assert.match(source, /modifierRank\.get\(a\)/);
  assert.match(source, /configuredToggleShortcut && !reservedShortcuts\(\)\.has\(normalizeShortcut\(configuredToggleShortcut\)\)/);
});

test("powerline shortcuts have terminal-input fallback routing", () => {
  assert.match(source, /function getPowerlineShortcutAction\(data: string\): PowerlineShortcutAction \| null/);
  assert.match(source, /matchesKey\(data, resolvedShortcuts\.stashHistory\)/);
  assert.match(source, /matchesKey\(data, resolvedShortcuts\.copyEditor\)/);
  assert.match(source, /matchesKey\(data, resolvedShortcuts\.cutEditor\)/);
  assert.match(source, /matchesKey\(data, bashModeSettings\.toggleShortcut\)/);
  assert.match(source, /runPowerlineShortcut\(ctx, powerlineShortcutAction\)/);
});
