import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

function findTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20_000 });
  const testsRoot = path.resolve(__dirname, "..");

  for (const file of findTestFiles(testsRoot)) {
    mocha.addFile(file);
  }

  return new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) reject(new Error(`${failures} tests failed`));
        else resolve();
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
