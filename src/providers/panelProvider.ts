/**
 * GitSage AI — Panel Provider (WebviewViewProvider)
 *
 * Hosts the sidebar Intelligence Panel. Manages:
 *   - HTML/CSS/JS webview lifecycle
 *   - Bidirectional message bus (extension ↔ webview)
 *   - Message routing for commit acceptance, login, key generation, etc.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { getKeyManager } from "../auth/keyManager";
import { getClient } from "../api/gitsageClient";
import { getDiffProvider } from "../git/diffProvider";

export const VIEW_ID = "gitsage.panel";

// ─── Types for messages ───────────────────────────────────────────────────────

interface WebviewMessage {
  type: string;
  payload?: any;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class PanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._extensionUri = context.extensionUri;
    this._context = context;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _resolveContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
        vscode.Uri.joinPath(this._extensionUri, "out"),
      ],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    // Handle messages FROM the webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this._handleMessage(message),
      undefined,
      this._context.subscriptions
    );

    // Push initial auth state when panel first opens
    this._sendInitialState();
  }

  /** Post a message TO the webview. */
  postMessage(message: WebviewMessage): void {
    this._view?.webview.postMessage(message);
  }

  // ─── Message Handler ───────────────────────────────────────────────────────

  private async _handleMessage(message: WebviewMessage): Promise<void> {
    const { type, payload } = message;

    switch (type) {
      // ── Auth ──
      case "TRIGGER_SIGN_IN": {
        vscode.commands.executeCommand("gitsage.signIn");
        break;
      }

      case "SAVE_API_KEY": {
        const km = getKeyManager();
        await km.saveApiKey(payload.apiKey);
        this.postMessage({ type: "AUTH_STATE_CHANGED", payload: { hasApiKey: true } });
        vscode.window.showInformationMessage("✅ GitSage: API key saved.");
        break;
      }

      case "LOGOUT": {
        await getKeyManager().clearAll();
        this.postMessage({
          type: "AUTH_STATE_CHANGED",
          payload: { hasApiKey: false, hasJwt: false, user: null },
        });
        break;
      }

      case "GET_AUTH_STATE": {
        await this._sendInitialState();
        break;
      }

      case "GET_GIT_HISTORY": {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          this.postMessage({ type: "GIT_HISTORY_RESPONSE", payload: { commits: [] } });
          break;
        }
        const cwd = folders[0].uri.fsPath;
        exec(
          `git log -n 10 --pretty=format:"%h||%an||%ar||%s"`,
          { cwd, timeout: 5000 },
          (err, stdout) => {
            if (err || !stdout) {
              this.postMessage({ type: "GIT_HISTORY_RESPONSE", payload: { commits: [] } });
              return;
            }
            const commits = stdout.trim().split("\n").map(line => {
              const [hash, author, date, subject] = line.split("||");
              return { hash, author, date, subject };
            });
            this.postMessage({ type: "GIT_HISTORY_RESPONSE", payload: { commits } });
          }
        );
        break;
      }

      case "GET_SETTINGS": {
        const config = vscode.workspace.getConfiguration("gitsage");
        this.postMessage({
          type: "SETTINGS_RESPONSE",
          payload: {
            commitStyle: config.get<string>("commitStyle", "conventional"),
            autoStagedCheck: config.get<boolean>("autoStagedCheck", true),
            scmIntegration: config.get<boolean>("scmIntegration", true),
            apiBaseUrl: config.get<string>("apiBaseUrl", "https://gitsage-api.up.railway.app")
          }
        });
        break;
      }

      case "UPDATE_SETTINGS": {
        const config = vscode.workspace.getConfiguration("gitsage");
        const { commitStyle, autoStagedCheck, scmIntegration, apiBaseUrl } = payload;
        
        if (commitStyle !== undefined) {
          await config.update("commitStyle", commitStyle, vscode.ConfigurationTarget.Global);
        }
        if (autoStagedCheck !== undefined) {
          await config.update("autoStagedCheck", autoStagedCheck, vscode.ConfigurationTarget.Global);
        }
        if (scmIntegration !== undefined) {
          await config.update("scmIntegration", scmIntegration, vscode.ConfigurationTarget.Global);
        }
        if (apiBaseUrl !== undefined) {
          await config.update("apiBaseUrl", apiBaseUrl, vscode.ConfigurationTarget.Global);
        }

        // Return updated settings
        this.postMessage({
          type: "SETTINGS_RESPONSE",
          payload: {
            commitStyle: config.get<string>("commitStyle", "conventional"),
            autoStagedCheck: config.get<boolean>("autoStagedCheck", true),
            scmIntegration: config.get<boolean>("scmIntegration", true),
            apiBaseUrl: config.get<string>("apiBaseUrl", "https://gitsage-api.up.railway.app")
          }
        });
        break;
      }

      // ── Commit acceptance ──
      case "COMMIT_ACCEPTED": {
        const diffProvider = getDiffProvider();
        const result = await diffProvider.performCommit(payload.message);
        if (result.success) {
          this.postMessage({ type: "COMMIT_SUCCESS" });
          vscode.window.showInformationMessage(
            `✅ GitSage: Committed — "${payload.message}"`
          );
        } else {
          this.postMessage({
            type: "COMMIT_ERROR",
            payload: { error: result.error },
          });
          vscode.window.showErrorMessage(`GitSage: Commit failed — ${result.error}`);
        }
        break;
      }

      case "COPY_COMMIT_TO_SCM": {
        this._injectIntoScm(payload.message);
        break;
      }

      // ── API Key management ──
      case "LIST_KEYS": {
        const km = getKeyManager();
        const jwt = await km.getJwtToken();
        if (!jwt) {
          this.postMessage({ type: "KEYS_RESPONSE", payload: { error: "Not logged in", keys: [] } });
          break;
        }
        try {
          const keys = await getClient().listApiKeys(jwt);
          this.postMessage({ type: "KEYS_RESPONSE", payload: { keys } });
        } catch (err) {
          const error = err instanceof Error ? err.message : "Failed to fetch keys";
          this.postMessage({ type: "KEYS_RESPONSE", payload: { error, keys: [] } });
        }
        break;
      }

      case "GENERATE_KEY": {
        const km = getKeyManager();
        const jwt = await km.getJwtToken();
        if (!jwt) { break; }
        try {
          const newKey = await getClient().generateApiKey(jwt, payload.name || "VS Code Key");
          // Also save the raw key as the active API key
          await km.saveApiKey(newKey.key);
          this.postMessage({ type: "KEY_GENERATED", payload: newKey });
        } catch (err) {
          const error = err instanceof Error ? err.message : "Failed to generate key";
          this.postMessage({ type: "KEY_GENERATE_ERROR", payload: { error } });
        }
        break;
      }

      case "REVOKE_KEY": {
        const km = getKeyManager();
        const jwt = await km.getJwtToken();
        if (!jwt || !payload.id) { break; }
        try {
          await getClient().revokeApiKey(jwt, payload.id);
          this.postMessage({ type: "KEY_REVOKED", payload: { id: payload.id } });
        } catch (err) {
          const error = err instanceof Error ? err.message : "Failed to revoke key";
          this.postMessage({ type: "KEY_REVOKE_ERROR", payload: { error } });
        }
        break;
      }

      // ── Usage stats ──
      case "GET_USAGE": {
        const km = getKeyManager();
        const jwt = await km.getJwtToken();
        if (!jwt) { break; }
        try {
          const stats = await getClient().getUsageStats(jwt, payload?.period ?? "30d");
          this.postMessage({ type: "USAGE_RESPONSE", payload: stats });
        } catch (err) {
          this.postMessage({ type: "USAGE_RESPONSE", payload: null });
        }
        break;
      }

      // ── Open external links ──
      case "OPEN_EXTERNAL": {
        vscode.env.openExternal(vscode.Uri.parse(payload.url));
        break;
      }

      // ── Trigger commands from panel ──
      case "RUN_COMMIT_COMMAND": {
        vscode.commands.executeCommand("gitsage.commit");
        break;
      }

      case "RUN_EXPLAIN_COMMAND": {
        vscode.commands.executeCommand("gitsage.explain");
        break;
      }

      // ── Tab navigation from extension host ──
      case "SWITCH_TAB": {
        // Forward directly to webview (webview handles its own tab state)
        this.postMessage({ type: "SWITCH_TAB", payload });
        break;
      }

      // ── Open external links ──
      case "OPEN_EXTERNAL": {
        vscode.env.openExternal(vscode.Uri.parse(payload.url));
        break;
      }
    }
  }

  public async refreshAuthState(): Promise<void> {
    await this._sendInitialState();
  }

  // ─── Initial state sync ────────────────────────────────────────────────────

  private async _sendInitialState(): Promise<void> {
    const km = getKeyManager();
    const [authState, userProfile] = await Promise.all([
      km.getAuthState(),
      km.getUserProfile(),
    ]);

    const hasApiKey = authState === "full" || authState === "apiKey";
    const hasJwt    = authState === "full" || authState === "jwt";

    this.postMessage({
      type: "INIT_STATE",
      payload: {
        hasApiKey,
        hasJwt,
        authState,
        user: userProfile,
      },
    });
  }

  // ─── SCM injection ─────────────────────────────────────────────────────────

  private _injectIntoScm(message: string): void {
    try {
      const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
      if (!gitExtension) { return; }
      const api = gitExtension.getAPI(1);
      const repo = api.repositories?.[0];
      if (repo?.inputBox) {
        repo.inputBox.value = message;
        vscode.window.showInformationMessage("GitSage: Commit message copied to SCM input box.");
      }
    } catch { /* silent */ }
  }

  // ─── HTML builder ──────────────────────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    const cssUri   = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "panel.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "panel.js")
    );
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, "media", "panel.html");
    const template = fs.readFileSync(htmlPath.fsPath, "utf8");

    return template
      .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSS_URI}}", cssUri.toString())
      .replaceAll("{{SCRIPT_URI}}", scriptUri.toString());
  }
}

// ─── Singleton management ─────────────────────────────────────────────────────

let _panelProvider: PanelProvider | undefined;

export function createPanelProvider(context: vscode.ExtensionContext): PanelProvider {
  _panelProvider = new PanelProvider(context);
  return _panelProvider;
}

export function getPanelProvider(): PanelProvider | undefined {
  return _panelProvider;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
