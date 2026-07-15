/**
 * GitSage AI — Explain Command
 *
 * Generates the "Three Pillars" report:
 *   - What Changed
 *   - Why It Matters
 *   - Reach & Scope + Impact Level
 *
 * Uses staged diff if available; falls back to current file diff.
 */

import * as vscode from "vscode";
import { getDiffProvider } from "../git/diffProvider";
import { getClient } from "../api/gitsageClient";
import { getKeyManager } from "../auth/keyManager";
import { getPanelProvider } from "../providers/panelProvider";
import { handleApiError } from "./commitCommand";

export async function explainCommand(): Promise<void> {
  const keyManager = getKeyManager();
  const diffProvider = getDiffProvider();
  const panel = getPanelProvider();

  // 1. Check API key
  const apiKey = await keyManager.getApiKey();
  if (!apiKey) {
    const choice = await vscode.window.showWarningMessage(
      "GitSage: No API key configured.",
      "Add API Key"
    );
    if (choice === "Add API Key") {
      await vscode.commands.executeCommand("gitsage.setApiKey");
    }
    return;
  }

  // 2. Get diff — prefer staged, fall back to active file
  await vscode.commands.executeCommand("gitsage.showPanel");
  panel?.postMessage({ type: "LOADING_START", payload: { mode: "explain" } });

  let diff = "";

  const stagedResult = await diffProvider.getStagedDiff();
  if (!stagedResult.isEmpty) {
    diff = stagedResult.diff;
  } else {
    // Try active editor file
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (activeFile) {
      diff = await diffProvider.getFileDiff(activeFile);
    }
  }

  if (!diff.trim()) {
    panel?.postMessage({ type: "LOADING_STOP" });
    vscode.window.showWarningMessage(
      "GitSage: No changes found to explain. Stage some files or open a modified file."
    );
    return;
  }

  // 3. Call explain endpoint
  try {
    const result = await getClient().explain(diff, apiKey);

    panel?.postMessage({
      type: "EXPLAIN_RESULT",
      payload: result,
    });
  } catch (err) {
    panel?.postMessage({ type: "LOADING_STOP" });
    handleApiError(err);
  }
}
