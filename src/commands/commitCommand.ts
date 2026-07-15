/**
 * GitSage AI — Commit Command
 *
 * Flow:
 *   1. Get staged diff via DiffProvider
 *   2. Check for API key; prompt if missing
 *   3. Send to /v1/intelligence/analyze
 *   4. Push result to the sidebar panel (WebviewView)
 *   5. Optionally inject commit message into VS Code's Git SCM input box
 */

import * as vscode from "vscode";
import { getDiffProvider } from "../git/diffProvider";
import { getClient, AnalyzeResponse, AuthenticationError, RateLimitError, NetworkError } from "../api/gitsageClient";
import { getKeyManager } from "../auth/keyManager";
import { getPanelProvider } from "../providers/panelProvider";

export async function commitCommand(context: vscode.ExtensionContext): Promise<void> {
  const keyManager = getKeyManager();
  const diffProvider = getDiffProvider();
  const panel = getPanelProvider();

  // 1. Verify we're in a Git repo
  const isGit = await diffProvider.isGitRepository();
  if (!isGit) {
    vscode.window.showErrorMessage(
      "GitSage: No Git repository found in the current workspace.",
      "Open Folder"
    ).then((choice) => {
      if (choice === "Open Folder") {
        vscode.commands.executeCommand("vscode.openFolder");
      }
    });
    return;
  }

  // 2. Check API key
  const apiKey = await keyManager.getApiKey();
  if (!apiKey) {
    const choice = await vscode.window.showWarningMessage(
      "GitSage: No API key configured. Add your GitSage API key to get started.",
      "Add API Key",
      "Get a Free Key"
    );
    if (choice === "Add API Key") {
      await vscode.commands.executeCommand("gitsage.setApiKey");
    } else if (choice === "Get a Free Key") {
      vscode.env.openExternal(vscode.Uri.parse("https://gitsage-ai.vercel.app/docs"));
    }
    return;
  }

  // 3. Get staged diff
  const config = vscode.workspace.getConfiguration("gitsage");
  const autoStagedCheck = config.get<boolean>("autoStagedCheck", true);

  // Ensure the panel is visible & show loading state
  await vscode.commands.executeCommand("gitsage.showPanel");
  panel?.postMessage({ type: "LOADING_START", payload: { mode: "commit" } });

  const diffResult = await diffProvider.getStagedDiff();

  if (diffResult.isEmpty && autoStagedCheck) {
    panel?.postMessage({ type: "LOADING_STOP" });
    const choice = await vscode.window.showWarningMessage(
      "GitSage: No staged changes found. Stage your files with `git add` first.",
      "Stage All (git add .)",
      "Cancel"
    );
    if (choice === "Stage All (git add .)") {
      const terminal = vscode.window.createTerminal("GitSage");
      terminal.sendText("git add .");
      terminal.show();
    }
    return;
  }

  if (diffResult.filteredFiles.length > 0) {
    vscode.window.showInformationMessage(
      `GitSage: Excluded ${diffResult.filteredFiles.length} sensitive file(s) from analysis: ${diffResult.filteredFiles.join(", ")}`
    );
  }

  // 4. Call the API
  const style = config.get<string>("commitStyle", "conventional");
  const branch = await diffProvider.getBranchName();

  try {
    panel?.postMessage({
      type: "ANALYSIS_STEP",
      payload: { step: "Reading diff context..." },
    });

    const result: AnalyzeResponse = await getClient().analyze(
      diffResult.diff,
      apiKey,
      branch ? `Branch: ${branch}` : undefined,
      style
    );

    // 5. Push result to panel
    panel?.postMessage({
      type: "ANALYSIS_RESULT",
      payload: {
        mode: "commit",
        ...result,
        stagedFiles: diffResult.stagedFiles,
        wasTruncated: diffResult.wasTruncated,
      },
    });

    // 6. Also inject into SCM input box (non-blocking, best-effort)
    const scmIntegration = config.get<boolean>("scmIntegration", true);
    if (scmIntegration) {
      tryInjectIntoScm(result.commit_message);
    }

  } catch (err) {
    panel?.postMessage({ type: "LOADING_STOP" });
    handleApiError(err);
  }
}

/**
 * Tries to inject the commit message into VS Code's built-in Git SCM input box.
 * This is best-effort — if the Git extension isn't available, it silently skips.
 */
function tryInjectIntoScm(message: string): void {
  try {
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (!gitExtension) { return; }
    const api = gitExtension.getAPI(1);
    const repo = api.repositories?.[0];
    if (repo?.inputBox) {
      repo.inputBox.value = message;
    }
  } catch {
    // Silent — panel already has the message
  }
}

export function handleApiError(err: unknown): void {
  if (err instanceof AuthenticationError) {
    vscode.window.showErrorMessage(
      `GitSage: ${err.message}`,
      "Update API Key"
    ).then((c) => {
      if (c === "Update API Key") {
        vscode.commands.executeCommand("gitsage.setApiKey");
      }
    });
  } else if (err instanceof RateLimitError) {
    vscode.window.showWarningMessage(
      `GitSage: Daily rate limit reached (100 requests/day). ${err.message}`
    );
  } else if (err instanceof NetworkError) {
    vscode.window.showErrorMessage(
      `GitSage: Network error — ${err.message}`
    );
  } else {
    const msg = err instanceof Error ? err.message : "Unknown error";
    vscode.window.showErrorMessage(`GitSage: ${msg}`);
  }
}
