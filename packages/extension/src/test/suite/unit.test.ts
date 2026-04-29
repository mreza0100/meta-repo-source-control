import * as assert from "node:assert";
import { __testing } from "../../extension";

const { statusBadge, COMMAND_FILE, TMP_DIR_NAME, CMD, VIEW_ID } = __testing;

suite("statusBadge", () => {
  test("untracked '??' maps to 'U'", () => {
    assert.strictEqual(statusBadge("??"), "U");
  });

  test("staged modification 'M ' returns 'M'", () => {
    assert.strictEqual(statusBadge("M "), "M");
  });

  test("unstaged modification ' M' returns 'M'", () => {
    assert.strictEqual(statusBadge(" M"), "M");
  });

  test("added file 'A ' returns 'A'", () => {
    assert.strictEqual(statusBadge("A "), "A");
  });

  test("deleted file ' D' returns 'D'", () => {
    assert.strictEqual(statusBadge(" D"), "D");
  });

  test("renamed file 'R ' returns 'R'", () => {
    assert.strictEqual(statusBadge("R "), "R");
  });
});

suite("brand identifiers", () => {
  test("view id uses metarepoSc namespace", () => {
    assert.match(VIEW_ID, /^metarepoSc\./);
  });

  test("all 5 commands use metarepoSc namespace", () => {
    const ids = Object.values(CMD);
    assert.strictEqual(ids.length, 5);
    for (const id of ids) {
      assert.match(id, /^metarepoSc\./, `command id ${id} not under metarepoSc namespace`);
    }
  });

  test("command file path uses metarepo-sc directory", () => {
    assert.match(COMMAND_FILE, /metarepo-sc/);
    assert.ok(COMMAND_FILE.endsWith("/cmd"), `expected COMMAND_FILE to end with /cmd, got ${COMMAND_FILE}`);
  });

  test("tmp dir uses metarepo-sc-tmp brand", () => {
    assert.strictEqual(TMP_DIR_NAME, "metarepo-sc-tmp");
  });

  test("no legacy wsdiff strings in any constant", () => {
    const allStrings = [VIEW_ID, COMMAND_FILE, TMP_DIR_NAME, ...Object.values(CMD)];
    for (const s of allStrings) {
      assert.doesNotMatch(s, /wsdiff/i, `legacy 'wsdiff' brand leaked into ${s}`);
    }
  });
});
