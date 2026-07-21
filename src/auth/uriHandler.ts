import * as vscode from "vscode";
import { getKeyManager } from "./keyManager";
import { getClient } from "../api/gitsageClient";
import { getPanelProvider } from "../providers/panelProvider";

export class GitSageUriHandler implements vscode.UriHandler {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    console.log("[GitSage] Received callback URI:", uri.toString());
    
    // Normalize path by stripping leading/trailing slashes
    const normalizedPath = uri.path.replace(/^\//, "").replace(/\/$/, "");
    if (normalizedPath === "auth/callback") {
      const queryParams = new URLSearchParams(uri.query);
      const code = queryParams.get("code");
      const state = queryParams.get("state");

      if (!code || !state) {
        vscode.window.showErrorMessage("GitSage: Callback URL is missing authentication details.");
        return;
      }

      await this.handleAuthCallback(code, state);
    }
  }

  private async handleAuthCallback(code: string, state: string): Promise<void> {
    const expectedState = this.context.globalState.get<string>("gitsage.authState");
    if (!expectedState || expectedState !== state) {
      vscode.window.showErrorMessage("GitSage: State verification failed. Please sign in again.");
      return;
    }

    // Clear state once matched
    this.context.globalState.update("gitsage.authState", undefined);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "GitSage: Finalizing authentication...",
        cancellable: false,
      },
      async () => {
        try {
          const response = await getClient().exchangeCodeForToken(code, state);
          
          if (!response || !response.token || !response.user) {
            throw new Error("Invalid token exchange response.");
          }

          const keyManager = getKeyManager();
          await keyManager.saveJwtToken(response.token);
          await keyManager.saveUserProfile(response.user.name, response.user.email);

          // If the exchange returned an API key, save it too
          const apiKey = (response.user as any).api_key || (response.user as any).apiKey;
          if (apiKey) {
            await keyManager.saveApiKey(apiKey);
          }

          vscode.window.showInformationMessage(`Successfully signed in to GitSage as ${response.user.name}!`);

          // Show panel and refresh state
          await vscode.commands.executeCommand("gitsage.showPanel");
          const panel = getPanelProvider();
          if (panel) {
            await panel.refreshAuthState();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Exchange failed";
          vscode.window.showErrorMessage(`GitSage authentication failed: ${msg}`);
        }
      }
    );
  }
}
