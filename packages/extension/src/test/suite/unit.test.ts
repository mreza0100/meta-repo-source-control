import * as assert from "node:assert";
import { __testing } from "../../extension";

const { statusBadge, shouldIgnorePath, COMMAND_FILE, TMP_DIR_NAME, CMD, VIEW_ID } = __testing;

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

suite("shouldIgnorePath", () => {
  test("ignores .git internals (covers our own metarepo-sc-tmp writes)", () => {
    assert.strictEqual(shouldIgnorePath("/repo/.git/metarepo-sc-tmp/file.ts"), true);
    assert.strictEqual(shouldIgnorePath("/repo/.git/index"), true);
    assert.strictEqual(shouldIgnorePath("/repo/.git/HEAD"), true);
  });

  test("ignores node_modules and build outputs", () => {
    assert.strictEqual(shouldIgnorePath("/repo/node_modules/foo/index.js"), true);
    assert.strictEqual(shouldIgnorePath("/repo/dist/extension.js"), true);
    assert.strictEqual(shouldIgnorePath("/repo/out/test/runTest.js"), true);
    assert.strictEqual(shouldIgnorePath("/repo/build/output.bin"), true);
    assert.strictEqual(shouldIgnorePath("/repo/coverage/lcov.info"), true);
  });

  test("ignores TS daemon and editor swap files", () => {
    assert.strictEqual(shouldIgnorePath("/repo/tsconfig.tsbuildinfo"), true);
    assert.strictEqual(shouldIgnorePath("/repo/build.log"), true);
    assert.strictEqual(shouldIgnorePath("/repo/.foo.swp"), true);
    assert.strictEqual(shouldIgnorePath("/repo/.bar.swo"), true);
  });

  test("ignores OS metadata files", () => {
    assert.strictEqual(shouldIgnorePath("/repo/src/.DS_Store"), true);
    assert.strictEqual(shouldIgnorePath("/repo/Thumbs.db"), true);
  });

  test("does NOT ignore real source files", () => {
    assert.strictEqual(shouldIgnorePath("/repo/src/extension.ts"), false);
    assert.strictEqual(shouldIgnorePath("/repo/README.md"), false);
    assert.strictEqual(shouldIgnorePath("/repo/package.json"), false);
    assert.strictEqual(shouldIgnorePath("/repo/test/file.bats"), false);
  });

  test("does NOT ignore files merely containing denylisted substrings outside path segments", () => {
    // 'distance.ts' contains 'dist' but isn't in a /dist/ directory.
    assert.strictEqual(shouldIgnorePath("/repo/src/distance.ts"), false);
    // 'mygit.ts' contains 'git' but isn't in /.git/.
    assert.strictEqual(shouldIgnorePath("/repo/src/mygit.ts"), false);
  });
});
