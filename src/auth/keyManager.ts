/**
 * GitSage AI — Secure Key Manager
 *
 * Wraps VS Code's SecretStorage API to persist:
 *   - The GitSage API key  (for intelligence calls, X-API-Key)
 *   - The JWT session token (for portal features, Authorization: Bearer)
 *
 * SecretStorage is encrypted by the OS (Keychain on macOS, Credential
 * Manager on Windows, libsecret on Linux) — never written to disk in plain text.
 */

import * as vscode from "vscode";

const KEY_API_KEY   = "gitsage.apiKey";
const KEY_JWT_TOKEN = "gitsage.jwtToken";
const KEY_USER_NAME = "gitsage.userName";
const KEY_USER_EMAIL = "gitsage.userEmail";

export class KeyManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ── API Key (X-API-Key header for intelligence endpoints) ─────────────────

  async saveApiKey(key: string): Promise<void> {
    await this.secrets.store(KEY_API_KEY, key.trim());
  }

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(KEY_API_KEY);
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(KEY_API_KEY);
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key && key.length > 0;
  }

  // ── JWT Token (Bearer token for auth/portal endpoints) ───────────────────

  async saveJwtToken(token: string): Promise<void> {
    await this.secrets.store(KEY_JWT_TOKEN, token);
  }

  async getJwtToken(): Promise<string | undefined> {
    return this.secrets.get(KEY_JWT_TOKEN);
  }

  async clearJwtToken(): Promise<void> {
    await this.secrets.delete(KEY_JWT_TOKEN);
  }

  async hasJwtToken(): Promise<boolean> {
    const token = await this.getJwtToken();
    return !!token && token.length > 0;
  }

  // ── User profile cache (non-sensitive, stored in secrets for convenience) ─

  async saveUserProfile(name: string, email: string): Promise<void> {
    await this.secrets.store(KEY_USER_NAME, name);
    await this.secrets.store(KEY_USER_EMAIL, email);
  }

  async getUserProfile(): Promise<{ name: string; email: string } | undefined> {
    const name  = await this.secrets.get(KEY_USER_NAME);
    const email = await this.secrets.get(KEY_USER_EMAIL);
    if (!name || !email) {
      return undefined;
    }
    return { name, email };
  }

  // ── Full logout ───────────────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    await Promise.all([
      this.secrets.delete(KEY_API_KEY),
      this.secrets.delete(KEY_JWT_TOKEN),
      this.secrets.delete(KEY_USER_NAME),
      this.secrets.delete(KEY_USER_EMAIL),
    ]);
  }

  // ── Auth state helper ─────────────────────────────────────────────────────

  /**
   * Returns the "best" auth state:
   *   'full'   — JWT + API key (portal + intelligence)
   *   'apiKey' — API key only (intelligence only, like CLI)
   *   'jwt'    — JWT only (portal only, no intelligence)
   *   'none'   — Not authenticated
   */
  async getAuthState(): Promise<"full" | "apiKey" | "jwt" | "none"> {
    const [hasKey, hasJwt] = await Promise.all([
      this.hasApiKey(),
      this.hasJwtToken(),
    ]);
    if (hasKey && hasJwt) { return "full"; }
    if (hasKey)           { return "apiKey"; }
    if (hasJwt)           { return "jwt"; }
    return "none";
  }
}

// Singleton — created once in extension.ts and passed around
let _keyManager: KeyManager | undefined;

export function createKeyManager(secrets: vscode.SecretStorage): KeyManager {
  _keyManager = new KeyManager(secrets);
  return _keyManager;
}

export function getKeyManager(): KeyManager {
  if (!_keyManager) {
    throw new Error("KeyManager not initialized. Call createKeyManager() first.");
  }
  return _keyManager;
}
