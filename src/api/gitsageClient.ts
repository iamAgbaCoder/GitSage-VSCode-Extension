/**
 * GitSage AI — HTTP Client
 *
 * Communicates with the GitSage backend API.
 * Supports both JWT (portal features) and X-API-Key (intelligence endpoints).
 * Zero external runtime dependencies — uses Node's built-in https module.
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";
import * as vscode from "vscode";

// ─── Response types ─────────────────────────────────────────────────────────

export interface AnalyzeResponse {
  commit_message: string;
  explanation: string;
  confidence: number;   // 0-100
  analysis_time_ms: number;
  provider: string;
  model: string;
}

export interface CommitResponse {
  message: string;
  confidence: number;   // 0-100
  analysis_time_ms: number;
  provider: string;
  model: string;
}

export interface ExplainResponse {
  what_changed: string;
  why_it_matters: string;
  reach_scope: string;  // "Global" | "Module" | "Method"
  impact_level: string; // "High" | "Medium" | "Low"
}

export interface AuthResponse {
  status: string;
  token: string;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  createdAt?: string;
  apiKey?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed?: string;
  status: "active" | "revoked";
}

export interface NewApiKey {
  id: string;
  name: string;
  key: string;          // Raw key — only shown once
  createdAt: string;
}

export interface UsageStats {
  period: string;
  total_requests: number;
  total_tokens?: number;
  total_files_analyzed?: number;
  breakdown: Array<{
    date: string;
    requests: number;
    token_consumption: number;
  }>;
}

// ─── Error classes ───────────────────────────────────────────────────────────

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

type ApiPayload = Record<string, unknown>;

interface ApiEnvelope<T> {
  success: boolean;
  statusCode?: number;
  message?: string;
  data?: T;
}

export class GitSageClient {
  private baseUrl: string;
  private static readonly TIMEOUT_MS = 45_000;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ||
      vscode.workspace
        .getConfiguration("gitsage")
        .get<string>("apiBaseUrl", "https://gitsage-api.up.railway.app");
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: ApiPayload,
    headers?: Record<string, string>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const bodyStr = body ? JSON.stringify(body) : undefined;

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "gitsage-vscode/0.1.0",
          ...(bodyStr
            ? { "Content-Length": Buffer.byteLength(bodyStr).toString() }
            : {}),
          ...headers,
        },
        timeout: GitSageClient.TIMEOUT_MS,
      };

      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed: ApiEnvelope<T>;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return reject(new NetworkError("Invalid JSON response from server."));
          }

          if (parsed.success === false) {
            const code = parsed.statusCode ?? res.statusCode ?? 0;
            const msg = parsed.message ?? "Unknown error";
            if (code === 401) {
              return reject(
                new AuthenticationError(
                  `Invalid or expired credentials. ${msg}`
                )
              );
            }
            if (code === 429) {
              return reject(new RateLimitError(msg));
            }
            return reject(new Error(`API error ${code}: ${msg}`));
          }

          resolve(parsed.data as T);
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new NetworkError("Request timed out. Check your connection."));
      });

      req.on("error", (err) => {
        reject(new NetworkError(`Network error: ${err.message}`));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // ── Intelligence API ─────────────────────────────────────────────────────

  /** Single-round-trip: returns commit_message + explanation + confidence. */
  async analyze(
    diff: string,
    apiKey: string,
    context?: string,
    style: string = "conventional"
  ): Promise<AnalyzeResponse> {
    return this.request<AnalyzeResponse>(
      "POST",
      "/v1/intelligence/analyze",
      { diff, context: context ?? "", style },
      { "X-API-Key": apiKey }
    );
  }

  /** Commit-message-only endpoint. */
  async commit(
    diff: string,
    apiKey: string,
    context?: string
  ): Promise<CommitResponse> {
    return this.request<CommitResponse>(
      "POST",
      "/v1/intelligence/commit",
      { diff, context: context ?? "" },
      { "X-API-Key": apiKey }
    );
  }

  /** Three-Pillars explanation endpoint. */
  async explain(diff: string, apiKey: string): Promise<ExplainResponse> {
    return this.request<ExplainResponse>(
      "POST",
      "/v1/intelligence/explain",
      { diff },
      { "X-API-Key": apiKey }
    );
  }

  // ── Auth API ─────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>("POST", "/v1/auth/login", {
      email,
      password,
    });
  }

  async signup(
    email: string,
    password: string,
    name: string
  ): Promise<AuthResponse> {
    return this.request<AuthResponse>("POST", "/v1/auth/signup", {
      email,
      password,
      name,
    });
  }

  async getMe(jwtToken: string): Promise<UserProfile> {
    return this.request<UserProfile>("GET", "/v1/auth/me", undefined, {
      Authorization: `Bearer ${jwtToken}`,
    });
  }

  // ── API Key Management ───────────────────────────────────────────────────

  async listApiKeys(jwtToken: string): Promise<ApiKey[]> {
    const data = await this.request<{ keys: ApiKey[] } | ApiKey[]>(
      "GET",
      "/v1/api-keys",
      undefined,
      { Authorization: `Bearer ${jwtToken}` }
    );
    return Array.isArray(data) ? data : data.keys ?? [];
  }

  async generateApiKey(jwtToken: string, name: string): Promise<NewApiKey> {
    return this.request<NewApiKey>(
      "POST",
      "/v1/api-keys",
      { name },
      { Authorization: `Bearer ${jwtToken}` }
    );
  }

  async revokeApiKey(jwtToken: string, id: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/v1/api-keys/${id}`,
      undefined,
      { Authorization: `Bearer ${jwtToken}` }
    );
  }

  // ── Usage Stats ──────────────────────────────────────────────────────────

  async getUsageStats(
    jwtToken: string,
    period: "7d" | "30d" = "30d"
  ): Promise<UsageStats> {
    return this.request<UsageStats>(
      "GET",
      `/v1/usage/stats?period=${period}`,
      undefined,
      { Authorization: `Bearer ${jwtToken}` }
    );
  }

  // ── Health ───────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<unknown>("GET", "/health");
      return true;
    } catch {
      return false;
    }
  }
}

/** Singleton factory — shares one client instance per extension lifetime. */
let _client: GitSageClient | undefined;
export function getClient(): GitSageClient {
  if (!_client) {
    _client = new GitSageClient();
  }
  return _client;
}

/** Call this when the config changes so the client is recreated. */
export function resetClient(): void {
  _client = undefined;
}
