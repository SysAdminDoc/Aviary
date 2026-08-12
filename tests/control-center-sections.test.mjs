import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sections = [
  ["advanced.ts", ["buildTrustRows", "buildIntegrationRows", "buildBackupRows"]],
  ["data.ts", ["buildSnapshotRows", "buildLibraryRows", "buildExportRows", "buildMediaRows"]],
  ["presets.ts", ["buildPresetRows"]],
  ["reading.ts", ["buildAppearanceRows", "buildLayoutRows", "buildPerformanceRows", "buildFilterRows", "buildHiddenPostRows"]]
];
const sharedHelpers = [
  "actionRow", "toggleRow", "selectRow", "readonlyRow", "dataRow", "textInputRow",
  "secretInputRow", "integerInputRow", "textareaRow", "surfaceRow", "setStatus", "setStatusCopy",
  "save", "render", "formatCopy", "localizedCopy", "t", "el", "button", "presetIcon"
];

test("Control Center section builders use the typed panel context", async () => {
  const main = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(main, /PanelContext/);
  assert.match(main, /sectionRegistry/);
  assert.doesNotMatch(main, /const (appearance|layout|trust|preset|snapshot|integration|performance|library|backup|export|media|filter|hiddenPost)Rows\s*=/);

  for (const [filename, builders] of sections) {
    const source = await readFile(path.join(root, "src/ui/control-center/sections", filename), "utf8");
    assert.match(source, /import type \{ PanelContext \}/, `${filename} must import PanelContext`);
    for (const builder of builders) {
      assert.match(source, new RegExp(`export function ${builder}\\(ctx: PanelContext\\)`));
    }
    for (const helper of sharedHelpers) {
      assert.doesNotMatch(
        source,
        new RegExp(`(?<![\\w.])${helper}\\(`),
        `${filename} must call ${helper} through PanelContext`
      );
    }
    assert.doesNotMatch(source, /(?<![\w.])options\s*\./, `${filename} must use ctx.options`);
  }
});
