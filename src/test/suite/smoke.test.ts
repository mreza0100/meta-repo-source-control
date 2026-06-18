import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Extension smoke", () => {
  test("extension is present in registry", () => {
    const ext = vscode.extensions.getExtension("gtd-local.metarepo-sc-gtd");
    assert.ok(ext, "metarepo-sc-gtd extension not found in vscode.extensions registry");
  });

  test("extension activates on startup", async () => {
    const ext = vscode.extensions.getExtension("gtd-local.metarepo-sc-gtd");
    assert.ok(ext, "extension not found");
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, "extension failed to activate");
  });

  test("all 6 contributed commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    const expected = [
      "metarepoSc.refresh",
      "metarepoSc.openDiff",
      "metarepoSc.openFile",
      "metarepoSc.expandAll",
      "metarepoSc.discardChanges",
      "metarepoSc.discardAllChanges",
    ];
    for (const id of expected) {
      assert.ok(cmds.includes(id), `command not registered: ${id}`);
    }
  });
});
