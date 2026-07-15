/**
 * GitSage AI — Extension Entry Point
 *
 * Activated on `onStartupFinished`. Registers:
 *   - All commands (commit, explain, auth, show panel)
 *   - Sidebar WebviewViewProvider
 *   - SCM title bar button
 *   - Configuration change listener
 */

import * as vscode from "vscode";
import { createKeyManager } from "./auth/keyManager";
import { resetClient } from "./api/gitsageClient";
import { resetDiffProvider } from "./git/diffProvider";
import { commitCommand } from "./commands/commitCommand";
import { explainCommand } from "./commands/explainCommand";
import { setApiKeyCommand, clearApiKeyCommand } from "./commands/authCommand";
import {
  createPanelProvider,
  VIEW_ID,
} from "./providers/panelProvider";
import { registerScmCommand } from "./providers/scmProvider";

export function activate(context: vscode.ExtensionContext): void {
  console.log("[GitSage] Activating extension...");

  // ── 1. Initialize core singletons ──────────────────────────────────────────
  createKeyManager(context.secrets);

  // ── 2. Register WebviewViewProvider (sidebar panel) ───────────────────────
  const panelProvider = createPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, panelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true, // Keep panel state when switching tabs
      },
    })
  );

  // ── 3. Register commands ───────────────────────────────────────────────────

  context.subscriptions.push(
    // Analyze & Commit
    vscode.commands.registerCommand("gitsage.commit", () =>
      commitCommand(context)
    ),

    // Explain Changes
    vscode.commands.registerCommand("gitsage.explain", () =>
      explainCommand()
    ),

    // Show the sidebar panel
    vscode.commands.registerCommand("gitsage.showPanel", () => {
      vscode.commands.executeCommand("workbench.view.extension.gitsage-container");
    }),

    // API Key management
    vscode.commands.registerCommand("gitsage.setApiKey", () =>
      setApiKeyCommand()
    ),

    vscode.commands.registerCommand("gitsage.clearApiKey", () =>
      clearApiKeyCommand()
    )
  );

  // ── 4. Register SCM title bar button ─────────────────────────────────────
  registerScmCommand(context);

  // ── 5. Config change listener ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitsage.apiBaseUrl")) {
        // Reset the HTTP client so the new URL is picked up
        resetClient();
        console.log("[GitSage] API base URL changed — HTTP client reset.");
      }
      if (e.affectsConfiguration("gitsage")) {
        resetDiffProvider();
      }
    })
  );

  // ── 6. Welcome message on first install ───────────────────────────────────
  const isFirstInstall = !context.globalState.get<boolean>("gitsage.installed");
  if (isFirstInstall) {
    context.globalState.update("gitsage.installed", true);
    vscode.window
      .showInformationMessage(
        "🧠 GitSage AI installed! Add your API key to start generating commits.",
        "Add API Key",
        "Get Free Key"
      )
      .then((choice) => {
        if (choice === "Add API Key") {
          vscode.commands.executeCommand("gitsage.setApiKey");
        } else if (choice === "Get Free Key") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://gitsage-ai.vercel.app/docs")
          );
        }
      });
  }

  console.log("[GitSage] Extension activated successfully.");
}

export function deactivate(): void {
  console.log("[GitSage] Extension deactivated.");
}
