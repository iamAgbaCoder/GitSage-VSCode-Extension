/**
 * GitSage AI — Auth Commands
 *
 * Handles:
 *   - gitsage.setApiKey  → Quick-input paste flow for API key
 *   - gitsage.clearApiKey → Clears stored credentials with confirmation
 */

import * as vscode from "vscode";
import * as crypto from "crypto";
import { getKeyManager } from "../auth/keyManager";
import { getClient } from "../api/gitsageClient";
import { getPanelProvider } from "../providers/panelProvider";

function assertValidAuthResponse(
  response: unknown
): asserts response is { token: string; user: { name: string; email: string } } {
  const auth = response as { token?: unknown; user?: { name?: unknown; email?: unknown } };
  if (
    !auth ||
    typeof auth.token !== "string" ||
    !auth.user ||
    typeof auth.user.name !== "string" ||
    typeof auth.user.email !== "string"
  ) {
    throw new Error("Authentication response was missing a token or user profile.");
  }
}

export async function setApiKeyCommand(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "GitSage AI — Set API Key",
    prompt: "Paste your GitSage API key (starts with gs_...)",
    placeHolder: "gs_xxxxxxxxxxxxxxxx",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "API key cannot be empty.";
      }
      if (!value.trim().startsWith("gs_")) {
        return "GitSage API keys start with 'gs_'. Get one at gitsage-ai.vercel.app/docs";
      }
      return undefined;
    },
  });

  if (!input) {
    return; // User cancelled
  }

  const apiKey = input.trim();
  const keyManager = getKeyManager();

  // Show progress while validating
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "GitSage: Validating API key...",
      cancellable: false,
    },
    async () => {
      try {
        // Light validation — try health check + key structure
        await keyManager.saveApiKey(apiKey);
        vscode.window.showInformationMessage(
          "GitSage: API key saved successfully! You're ready to generate commits."
        );

        // Notify panel to refresh auth state
        const panel = getPanelProvider();
        panel?.postMessage({ type: "AUTH_STATE_CHANGED", payload: { hasApiKey: true } });
      } catch (err) {
        vscode.window.showErrorMessage(
          `GitSage: Failed to save API key. ${err instanceof Error ? err.message : ""}`
        );
      }
    }
  );
}

export async function clearApiKeyCommand(): Promise<void> {
  const keyManager = getKeyManager();
  const hasKey = await keyManager.hasApiKey();
  const hasJwt = await keyManager.hasJwtToken();

  if (!hasKey && !hasJwt) {
    vscode.window.showInformationMessage("GitSage: No credentials are currently stored.");
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    "GitSage: Are you sure you want to clear all stored credentials (API key + JWT token)?",
    { modal: true },
    "Clear All",
    "Cancel"
  );

  if (choice === "Clear All") {
    await keyManager.clearAll();
    vscode.window.showInformationMessage("GitSage: All credentials cleared.");

    // Notify panel
    const panel = getPanelProvider();
    panel?.postMessage({ type: "AUTH_STATE_CHANGED", payload: { hasApiKey: false, hasJwt: false } });
  }
}

export async function signInCommand(context: vscode.ExtensionContext): Promise<void> {
  const state = crypto.randomBytes(16).toString("hex");
  await context.globalState.update("gitsage.authState", state);

  const config = vscode.workspace.getConfiguration("gitsage");
  const baseUrl = config.get<string>("apiBaseUrl", "https://gitsage-api.up.railway.app");

  const authUrl = vscode.Uri.parse(`${baseUrl}/v1/auth/vscode/login?state=${state}`);
  
  vscode.window.showInformationMessage("Opening browser to authorize GitSage AI...", "Open Browser").then((choice) => {
    if (choice === "Open Browser" || choice === undefined) {
      vscode.env.openExternal(authUrl);
    }
  });
}

export async function signOutCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Are you sure you want to sign out of GitSage AI? All stored credentials will be cleared.",
    { modal: true },
    "Sign Out",
    "Cancel"
  );

  if (choice === "Sign Out") {
    const keyManager = getKeyManager();
    await keyManager.clearAll();
    
    const panel = getPanelProvider();
    if (panel) {
      await panel.refreshAuthState();
    }
    
    vscode.window.showInformationMessage("You have been signed out of GitSage AI.");
  }
}

export async function openAccountCommand(): Promise<void> {
  // Show the panel and switch to the account tab
  await vscode.commands.executeCommand("gitsage.showPanel");
  const panel = getPanelProvider();
  if (panel) {
    panel.postMessage({ type: "SWITCH_TAB", payload: { tab: "account" } });
  }
}

export async function generateKeyCommand(): Promise<void> {
  const km = getKeyManager();
  const jwt = await km.getJwtToken();
  if (!jwt) {
    const signInChoice = await vscode.window.showErrorMessage(
      "GitSage: You must be signed in to generate an API key.",
      "Sign In"
    );
    if (signInChoice === "Sign In") {
      vscode.commands.executeCommand("gitsage.signIn");
    }
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "GitSage: Rotating API key...",
      cancellable: false,
    },
    async () => {
      try {
        const newKey = await getClient().generateApiKey(jwt, "VS Code Key");
        await km.saveApiKey(newKey.key);
        
        const panel = getPanelProvider();
        if (panel) {
          await panel.refreshAuthState();
          panel.postMessage({ type: "KEY_GENERATED", payload: newKey });
          panel.postMessage({ type: "SWITCH_TAB", payload: { tab: "keys" } });
        }
        
        vscode.window.showInformationMessage("GitSage: API key rotated successfully!");
      } catch (err) {
        vscode.window.showErrorMessage(
          `GitSage: Failed to rotate API key. ${err instanceof Error ? err.message : ""}`
        );
      }
    }
  );
}
