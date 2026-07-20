import * as path from "path";
import * as fs from "fs";
import { runTests } from "@vscode/test-electron";

function resolveVsCodeExecutablePath(): string {
  const envPath = process.env.VSCODE_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const candidates = [
        path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
        path.join(localAppData, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  throw new Error(
    "Could not find a local VS Code executable. Set VSCODE_EXECUTABLE_PATH to your Code.exe path."
  );
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const vscodeExecutablePath = resolveVsCodeExecutablePath();

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
