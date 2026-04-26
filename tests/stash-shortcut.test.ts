import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");

test("stash shortcut supports macOS Option+S character input", () => {
  assert.match(source, /pi\.registerShortcut\("alt\+s"/);
  assert.match(source, /function stashOrRestoreEditorText\(ctx: any\): void/);
  assert.match(source, /if \(data === "ß"\)/);
  assert.match(source, /stashOrRestoreEditorText\(ctx\);/);
});
