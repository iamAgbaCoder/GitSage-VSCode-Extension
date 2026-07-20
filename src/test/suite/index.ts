import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";

function collectTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const testsRoot = __dirname;
  for (const file of collectTestFiles(testsRoot)) {
    mocha.addFile(file);
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}

run().catch((err) => {
  console.error("Failed to run tests:", err);
  process.exit(1);
});
