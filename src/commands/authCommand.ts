/**
 * GitSage AI — Auth Commands
 *
 * Handles:
 *   - gitsage.setApiKey  → Quick-input paste flow for API key
 *   - gitsage.clearApiKey → Clears stored credentials with confirmation
 */

import * as vscode from "vscode";
import { getKeyManager } from "../auth/keyManager";
import { getClient } from "../api/gitsageClient";
import { getPanelProvider } from "../providers/panelProvider";

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
          "✅ GitSage: API key saved successfully! You're ready to generate commits."
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

/**
 * Called when the webview sends a LOGIN message.
 * Performs the login API call and stores the JWT + any API key in the response.
 */
export async function handleWebviewLogin(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; user?: any }> {
  try {
    const response = await getClient().login(email, password);
    const keyManager = getKeyManager();

    await keyManager.saveJwtToken(response.token);
    await keyManager.saveUserProfile(response.user.name, response.user.email);

    // If the backend returns an API key in the user object, save it too
    const apiKeyFromResponse =
      (response.user as any)?.api_key ||
      (response.user as any)?.apiKey;
    if (apiKeyFromResponse) {
      await keyManager.saveApiKey(apiKeyFromResponse);
    }

    return { success: true, user: response.user };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return { success: false, error: message };
  }
}

/**
 * Called when the webview sends a SIGNUP message.
 */
export async function handleWebviewSignup(
  email: string,
  password: string,
  name: string
): Promise<{ success: boolean; error?: string; user?: any }> {
  try {
    const response = await getClient().signup(email, password, name);
    const keyManager = getKeyManager();

    await keyManager.saveJwtToken(response.token);
    await keyManager.saveUserProfile(response.user.name, response.user.email);

    return { success: true, user: response.user };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signup failed";
    return { success: false, error: message };
  }
}
