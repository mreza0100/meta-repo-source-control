import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    // The folder containing the package.json — passed to VSCode as the
    // extension under development so it gets loaded into the test instance.
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    // The compiled test suite entry — VSCode invokes its `run()` export.
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // VSCode's IPC handle is a UNIX socket whose path has a 103-char limit on
    // many systems. Deep workspace paths (especially on CI with full repo URLs)
    // can blow past that. Pinning user-data-dir under os.tmpdir() keeps the
    // socket path short regardless of where the repo lives.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "metarepo-sc-"));

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [`--user-data-dir=${userDataDir}`],
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

void main();
