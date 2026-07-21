/**
 * GitSage AI — Webview Panel Main Script
 *
 * Communicates with the extension host via postMessage / onDidReceiveMessage.
 *
 * Tabs: Commit | Explain | History | Keys | Usage | Settings | Account
 * Auth: Browser-based (no in-webview password forms)
 */

// ─── VS Code API bridge ───────────────────────────────────────────────────────
declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
  setState: (state: unknown) => void;
  getState: () => unknown;
};

const vscode = acquireVsCodeApi();

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "commit" | "explain" | "history" | "keys" | "usage" | "settings" | "account";

interface AppState {
  activeTab: TabId;
  hasApiKey: boolean;
  hasJwt: boolean;
  authState: "full" | "apiKey" | "jwt" | "none";
  user: { name: string; email: string } | null;
  loading: boolean;
  loadingMode: "commit" | "explain" | null;
  loadingStep: string;
  commitResult: CommitResult | null;
  explainResult: ExplainResult | null;
  editMode: boolean;
  editedMessage: string;
  keys: ApiKey[];
  newKey: NewKeyData | null;
  usageStats: UsageStats | null;
  gitHistory: GitCommit[];
  historyLoading: boolean;
  settings: Settings | null;
  settingsSaved: boolean;
  toast: Toast | null;
}

interface CommitResult {
  commit_message: string;
  explanation: string;
  confidence: number;
  analysis_time_ms: number;
  provider: string;
  model: string;
  stagedFiles?: string[];
  wasTruncated?: boolean;
}

interface ExplainResult {
  what_changed: string;
  why_it_matters: string;
  reach_scope: string;
  impact_level: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed?: string;
  status: "active" | "revoked";
}

interface NewKeyData {
  id: string;
  name: string;
  key: string;
  createdAt: string;
}

interface UsageStats {
  period: string;
  total_requests: number;
  total_tokens?: number;
  total_files_analyzed?: number;
}

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

interface Settings {
  commitStyle: "conventional" | "simple" | "emoji";
  autoStagedCheck: boolean;
  scmIntegration: boolean;
  apiBaseUrl: string;
}

interface Toast {
  message: string;
  type: "success" | "error" | "info";
}

// ─── State ────────────────────────────────────────────────────────────────────

let state: AppState = {
  activeTab: "commit",
  hasApiKey: false,
  hasJwt: false,
  authState: "none",
  user: null,
  loading: false,
  loadingMode: null,
  loadingStep: "Initializing...",
  commitResult: null,
  explainResult: null,
  editMode: false,
  editedMessage: "",
  keys: [],
  newKey: null,
  usageStats: null,
  gitHistory: [],
  historyLoading: false,
  settings: null,
  settingsSaved: false,
  toast: null,
};

// ─── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  const app = document.getElementById("app");
  if (!app) { return; }
  app.innerHTML = buildHtml();
  bindEvents();
}

function buildHtml(): string {
  return `
    ${buildHeader()}
    ${buildTabs()}
    <div id="tab-content" class="gs-animate-in">
      ${buildTabContent()}
    </div>
    ${state.toast ? buildToast(state.toast) : ""}
  `;
}

// ─── Header ───────────────────────────────────────────────────────────────────

function buildHeader(): string {
  const badge = state.authState === "none"
    ? "Not connected"
    : state.user?.name?.split(" ")[0] ?? "Connected";
  return `
    <div class="gs-header">
      <div class="gs-header__logo">
        <div class="gs-header__dot"></div>
        <span class="gs-header__title">GitSage AI</span>
      </div>
      <div class="gs-header__badge">${escHtml(badge)}</div>
    </div>`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "commit",   label: "Commit",   icon: svgSparkle() },
  { id: "explain",  label: "Explain",  icon: svgBulb() },
  { id: "history",  label: "History",  icon: svgHistory() },
  { id: "keys",     label: "Keys",     icon: svgKey() },
  { id: "usage",    label: "Usage",    icon: svgChart() },
  { id: "settings", label: "Settings", icon: svgSettings() },
  { id: "account",  label: "Account",  icon: svgUser() },
];

function buildTabs(): string {
  return `
    <div class="gs-tabs gs-tabs--scroll">
      ${TABS.map(t => `
        <button class="gs-tab${state.activeTab === t.id ? " active" : ""}" data-tab="${t.id}" title="${t.label}">
          ${t.icon}
          <span class="gs-tab__label">${t.label}</span>
        </button>
      `).join("")}
    </div>`;
}

// ─── Tab Content Router ───────────────────────────────────────────────────────

function buildTabContent(): string {
  switch (state.activeTab) {
    case "commit":   return buildCommitTab();
    case "explain":  return buildExplainTab();
    case "history":  return buildHistoryTab();
    case "keys":     return buildKeysTab();
    case "usage":    return buildUsageTab();
    case "settings": return buildSettingsTab();
    case "account":  return buildAccountTab();
  }
}

// ─── Commit Tab ───────────────────────────────────────────────────────────────

function buildCommitTab(): string {
  if (state.loading && state.loadingMode === "commit") {
    return buildLoadingState(state.loadingStep);
  }
  if (state.commitResult) {
    return buildCommitResult(state.commitResult);
  }
  return buildCommitIdle();
}

function buildCommitIdle(): string {
  return `
    <div class="gs-empty">
      <div class="gs-empty__icon">${svgGit()}</div>
      <div class="gs-empty__title">Ready to Commit</div>
      <div class="gs-empty__desc">
        Stage your changes, then let GitSage AI write the perfect commit message with a confidence score.
      </div>
      ${!state.hasApiKey ? `
        <div class="gs-card gs-card--error" style="width:100%; margin-top:4px;">
          <div class="gs-card__body">
            <div class="gs-section-label text-red">⚠ No API Key</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
              Sign in or add an API key to start generating commits.
            </div>
            <button class="gs-btn gs-btn--primary w-full" id="btn-goto-account-from-commit">Sign In / Add Key</button>
          </div>
        </div>
      ` : `
        <button class="gs-btn gs-btn--primary w-full" id="btn-run-commit"
          style="margin-top:4px;padding:12px;font-size:12px;">
          ${svgSparkle()} Analyze &amp; Commit
        </button>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
          Shortcut: <span class="font-mono text-sage">Ctrl+Shift+G, Ctrl+Shift+C</span>
        </div>
      `}
    </div>`;
}

function buildLoadingState(step: string): string {
  return `
    <div class="gs-loading">
      <div style="position:relative;">
        <div class="gs-spinner"></div>
      </div>
      <div class="gs-loading__text">${escHtml(step)}</div>
      <div class="gs-loading__sub">Computing inference...</div>
    </div>`;
}

function buildCommitResult(r: CommitResult): string {
  const parts = parseCommitMessage(r.commit_message);

  const editContent = state.editMode ? `
    <textarea class="gs-textarea" id="edit-message" rows="3">${escHtml(state.editedMessage)}</textarea>
    <div class="gs-btn-row mt-6">
      <button class="gs-btn gs-btn--primary" id="btn-accept-edited">✓ Commit Edited</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-cancel-edit">✗ Cancel</button>
    </div>
  ` : `
    <div class="gs-commit-block">
      ${parts.type ? `<span class="gs-commit-block__type">${escHtml(parts.type)}</span>` : ""}
      ${parts.scope ? `<span class="gs-commit-block__paren">(</span><span class="gs-commit-block__scope">${escHtml(parts.scope)}</span><span class="gs-commit-block__paren">):</span>` : ""}
      <span class="gs-commit-block__msg">${escHtml(parts.subject || r.commit_message)}</span>
      ${parts.body ? `<div class="gs-commit-block__body">${escHtml(parts.body)}</div>` : ""}
    </div>
    <div class="gs-btn-row mt-6 gs-btn-row--3">
      <button class="gs-btn gs-btn--primary" id="btn-accept-commit">✓ Commit</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-edit-commit">✎ Edit</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-copy-scm">⬆ SCM</button>
    </div>
    <div class="gs-btn-row mt-6">
      <button class="gs-btn gs-btn--ghost w-full" id="btn-retry-commit">⟳ Retry</button>
      <button class="gs-btn gs-btn--danger" id="btn-discard-commit">✗ Discard</button>
    </div>
  `;

  return `
    <div class="gs-card gs-card--sage gs-animate-in">
      <div class="gs-card__header">
        <span class="gs-card__header-label">${svgCheck()} Intelligence Report</span>
        <span class="gs-card__badge gs-card__badge--verified">Verified</span>
      </div>
      <div class="gs-card__body" style="display:flex;flex-direction:column;gap:12px;">
        ${editContent}
        ${!state.editMode ? `
        <div class="gs-confidence">
          <div class="gs-confidence__header">
            <span>Trust Index</span>
            <span class="gs-confidence__value">${r.confidence}%</span>
          </div>
          <div class="gs-confidence__track">
            <div class="gs-confidence__fill" id="conf-bar" style="width:0%"></div>
          </div>
        </div>
        ${r.stagedFiles && r.stagedFiles.length > 0 ? `
        <div>
          <div class="gs-section-label">Affected Scopes</div>
          <div class="gs-chips">
            ${r.stagedFiles.map(f => `<span class="gs-chip">${escHtml(f.split("/").pop() ?? f)}</span>`).join("")}
          </div>
        </div>` : ""}
        <div class="gs-meta">
          <span>${escHtml(r.provider)}</span>
          <span class="gs-meta__sep">·</span>
          <span class="font-mono">${escHtml(r.model)}</span>
          <span class="gs-meta__sep">·</span>
          <span>${(r.analysis_time_ms / 1000).toFixed(1)}s</span>
          ${r.wasTruncated ? `<span class="gs-chip--muted" style="font-size:9px;color:var(--amber);">diff truncated</span>` : ""}
        </div>
        ` : ""}
      </div>
    </div>`;
}

// ─── Explain Tab ──────────────────────────────────────────────────────────────

function buildExplainTab(): string {
  if (state.loading && state.loadingMode === "explain") {
    return buildLoadingState(state.loadingStep);
  }
  if (state.explainResult) {
    return buildExplainResult(state.explainResult);
  }
  return `
    <div class="gs-empty">
      <div class="gs-empty__icon">${svgBulb()}</div>
      <div class="gs-empty__title">Three Pillars Report</div>
      <div class="gs-empty__desc">
        GitSage will explain what changed, why it matters, and the reach &amp; impact of your diff.
      </div>
      ${state.hasApiKey ? `
        <button class="gs-btn gs-btn--sky w-full" id="btn-run-explain" style="margin-top:8px;">
          ${svgBulb()} Generate Explanation
        </button>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
          Shortcut: <span class="font-mono text-sage">Ctrl+Shift+G, Ctrl+Shift+E</span>
        </div>
      ` : `
        <button class="gs-btn gs-btn--primary w-full" id="btn-goto-account-from-explain" style="margin-top:8px;">
          Sign In / Add API Key First
        </button>
      `}
    </div>`;
}

function buildExplainResult(r: ExplainResult): string {
  const impactClass = r.impact_level?.toLowerCase();
  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:6px;">
      <div class="gs-pillar">
        <div class="gs-pillar__label">${svgBulb()} What Changed</div>
        <div class="gs-pillar__body">${escHtml(r.what_changed)}</div>
      </div>
      <div class="gs-pillar">
        <div class="gs-pillar__label">${svgInfo()} Why It Matters</div>
        <div class="gs-pillar__body">${escHtml(r.why_it_matters)}</div>
      </div>
      <div class="gs-pillar">
        <div class="gs-pillar__label">${svgScope()} Reach &amp; Scope</div>
        <div class="gs-pillar__body">
          ${escHtml(r.reach_scope)}
          <div style="margin-top:8px;">
            <span class="gs-impact gs-impact--${impactClass}">
              Impact: ${escHtml(r.impact_level)}
            </span>
          </div>
        </div>
      </div>
      <button class="gs-btn gs-btn--ghost w-full" id="btn-retry-explain">⟳ Explain Again</button>
    </div>`;
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function buildHistoryTab(): string {
  if (state.historyLoading) {
    return buildLoadingState("Loading git history...");
  }
  if (state.gitHistory.length === 0) {
    return `
      <div class="gs-empty">
        <div class="gs-empty__icon">${svgHistory()}</div>
        <div class="gs-empty__title">No Commits Found</div>
        <div class="gs-empty__desc">Open a Git repository to view recent commit history.</div>
        <button class="gs-btn gs-btn--ghost w-full" id="btn-refresh-history" style="margin-top:8px;">
          ⟳ Refresh History
        </button>
      </div>`;
  }
  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:6px;">
      <div class="gs-section-label" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Recent Commits</span>
        <button class="gs-icon-btn" id="btn-refresh-history" title="Refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        </button>
      </div>
      <div class="gs-history-list">
        ${state.gitHistory.map(c => `
          <div class="gs-history-item">
            <span class="gs-history-item__hash">${escHtml(c.hash)}</span>
            <div class="gs-history-item__main">
              <div class="gs-history-item__subject">${escHtml(c.subject)}</div>
              <div class="gs-history-item__meta">${escHtml(c.author)} &middot; ${escHtml(c.date)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

// ─── Keys Tab ─────────────────────────────────────────────────────────────────

function buildKeysTab(): string {
  if (!state.hasJwt) {
    return `
      <div class="gs-empty">
        <div class="gs-empty__icon">${svgKey()}</div>
        <div class="gs-empty__title">Sign In Required</div>
        <div class="gs-empty__desc">Sign in to manage your GitSage API keys and view usage statistics.</div>
        <button class="gs-btn gs-btn--primary w-full" id="btn-signin-from-keys" style="margin-top:8px;">
          Sign In with Browser
        </button>
      </div>`;
  }

  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">
      ${state.newKey ? `
        <div class="gs-key-reveal">
          <div class="gs-key-reveal__label">🔑 New Key — Copy Now (shown once)</div>
          <div class="gs-key-reveal__value" id="reveal-key-value">${escHtml(state.newKey.key)}</div>
          <div class="gs-key-reveal__note">This key has also been saved as your active extension key.</div>
          <button class="gs-btn gs-btn--ghost w-full" id="btn-copy-new-key" style="margin-top:8px;font-size:10px;">
            Copy to Clipboard
          </button>
        </div>
      ` : ""}

      <button class="gs-btn gs-btn--primary w-full" id="btn-generate-key">
        ${svgKey()} Rotate API Key
      </button>

      <div class="gs-section-label">Active Keys</div>

      ${state.keys.length === 0 ? `
        <div style="font-size:11px;color:var(--text-muted);text-align:center;padding:16px;">
          No API keys found. Generate one above.
        </div>
      ` : state.keys.map(k => buildKeyItem(k)).join("")}
    </div>`;
}

function buildKeyItem(k: ApiKey): string {
  return `
    <div class="gs-key-item">
      <div class="gs-key-item__info">
        <div class="gs-key-item__name">${escHtml(k.name)}</div>
        <div class="gs-key-item__prefix">${escHtml(k.prefix)}...</div>
      </div>
      <span class="gs-key-item__status gs-key-item__status--${k.status}">${k.status}</span>
      <div class="gs-key-item__actions">
        ${k.status === "active" ? `
          <button class="gs-icon-btn gs-icon-btn--danger" data-key-id="${k.id}" data-action="revoke" title="Revoke">
            ${svgTrash()}
          </button>
        ` : ""}
      </div>
    </div>`;
}

// ─── Usage Tab ────────────────────────────────────────────────────────────────

function buildUsageTab(): string {
  if (!state.hasJwt) {
    return `
      <div class="gs-empty">
        <div class="gs-empty__icon">${svgChart()}</div>
        <div class="gs-empty__title">Sign In Required</div>
        <div class="gs-empty__desc">Sign in to view your API usage statistics.</div>
        <button class="gs-btn gs-btn--primary w-full" id="btn-signin-from-usage" style="margin-top:8px;">
          Sign In with Browser
        </button>
      </div>`;
  }

  if (!state.usageStats) {
    return `
      <div class="gs-empty">
        <div class="gs-empty__icon">${svgChart()}</div>
        <div class="gs-empty__title">No Usage Data</div>
        <div class="gs-empty__desc">Usage statistics will appear here after you start making requests.</div>
      </div>`;
  }

  const stats = state.usageStats;
  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">
      <div class="gs-section-label">Usage (${escHtml(stats.period)})</div>
      <div class="gs-stats-grid">
        <div class="gs-stat-card">
          <div class="gs-stat-card__label">Requests</div>
          <div class="gs-stat-card__value">${stats.total_requests ?? 0}</div>
        </div>
        <div class="gs-stat-card">
          <div class="gs-stat-card__label">Tokens</div>
          <div class="gs-stat-card__value">${formatNumber(stats.total_tokens ?? 0)}</div>
        </div>
        ${stats.total_files_analyzed ? `
        <div class="gs-stat-card">
          <div class="gs-stat-card__label">Files Analyzed</div>
          <div class="gs-stat-card__value">${formatNumber(stats.total_files_analyzed)}</div>
        </div>` : ""}
      </div>
      <button class="gs-btn gs-btn--ghost w-full" id="btn-refresh-usage" style="font-size:10px;">
        ⟳ Refresh Stats
      </button>
      <button class="gs-btn gs-btn--ghost w-full" data-open="https://gitsage-ai.vercel.app/dashboard">
        View Full Dashboard ↗
      </button>
    </div>`;
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function buildSettingsTab(): string {
  const s = state.settings;
  const commitStyle = s?.commitStyle ?? "conventional";
  const apiBaseUrl = s?.apiBaseUrl ?? "https://gitsage-api.up.railway.app";

  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">
      ${state.settingsSaved ? `<div class="gs-alert gs-alert--success">✓ Settings saved</div>` : ""}

      <div class="gs-card">
        <div class="gs-card__body" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <div class="gs-section-label">Commit Style</div>
            <div class="gs-radio-group" style="margin-top:6px;">
              ${["conventional", "simple", "emoji"].map(style => `
                <label class="gs-radio-label">
                  <input type="radio" name="commitStyle" value="${style}"
                    ${commitStyle === style ? "checked" : ""}
                    class="gs-radio" data-setting="commitStyle">
                  <span>${escHtml(style.charAt(0).toUpperCase() + style.slice(1))}</span>
                </label>
              `).join("")}
            </div>
          </div>

          <div class="gs-toggle-row">
            <div>
              <div class="gs-section-label">Auto Staged Check</div>
              <div style="font-size:10px;color:var(--text-muted);">Warn when no staged changes detected</div>
            </div>
            <label class="gs-toggle">
              <input type="checkbox" id="toggle-auto-staged" ${s?.autoStagedCheck !== false ? "checked" : ""}>
              <span class="gs-toggle__track"></span>
            </label>
          </div>

          <div class="gs-toggle-row">
            <div>
              <div class="gs-section-label">SCM Integration</div>
              <div style="font-size:10px;color:var(--text-muted);">Show button in Source Control title bar</div>
            </div>
            <label class="gs-toggle">
              <input type="checkbox" id="toggle-scm" ${s?.scmIntegration !== false ? "checked" : ""}>
              <span class="gs-toggle__track"></span>
            </label>
          </div>

          <div>
            <div class="gs-section-label">API Base URL</div>
            <input type="text" class="gs-form__input" id="input-api-url"
              value="${escHtml(apiBaseUrl)}"
              placeholder="https://gitsage-api.up.railway.app"
              style="margin-top:6px;">
          </div>

          <button class="gs-btn gs-btn--primary w-full" id="btn-save-settings">
            Save Settings
          </button>
        </div>
      </div>
    </div>`;
}

// ─── Account Tab ──────────────────────────────────────────────────────────────

function buildAccountTab(): string {
  if (state.hasJwt && state.user) {
    return buildAccountInfo(state.user);
  }
  return buildAccountSignedOut();
}

function buildAccountInfo(user: { name: string; email: string }): string {
  return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">
      <div class="gs-card gs-card--sage">
        <div class="gs-card__body" style="display:flex;flex-direction:column;gap:8px;">
          <div class="gs-user-avatar">${escHtml(user.name.charAt(0).toUpperCase())}</div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(user.name)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escHtml(user.email)}</div>
          <div class="gs-btn-row mt-6">
            <button class="gs-btn gs-btn--danger" id="btn-logout">Sign Out</button>
            <button class="gs-btn gs-btn--sky"    id="btn-open-portal">Portal ↗</button>
          </div>
        </div>
      </div>

      <div class="gs-card">
        <div class="gs-card__body">
          <div class="gs-section-label">API Key Status</div>
          <div class="flex items-center gap-6 mt-6">
            <div class="gs-header__dot"></div>
            <span style="font-size:11px;color:var(--sage);font-weight:600;">
              ${state.hasApiKey ? "Key Configured" : "No Key — Generate One in Keys Tab"}
            </span>
          </div>
          <div class="gs-btn-row mt-6">
            <button class="gs-btn gs-btn--ghost w-full" id="btn-goto-keys">Manage Keys</button>
          </div>
        </div>
      </div>

      <div class="gs-card">
        <div class="gs-card__body">
          <div class="gs-section-label">Quick Links</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
            <button class="gs-btn gs-btn--ghost w-full" data-open="https://gitsage-ai.vercel.app/dashboard">
              Dashboard ↗
            </button>
            <button class="gs-btn gs-btn--ghost w-full" data-open="https://gitsage-ai.vercel.app/docs">
              Docs ↗
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function buildAccountSignedOut(): string {
  return `
    <div class="gs-animate-in">
      <div class="gs-empty__icon" style="margin:12px auto 16px;">${svgUser()}</div>

      <div class="gs-card" style="margin-bottom:10px;">
        <div class="gs-card__body" style="text-align:center;padding:24px 16px;">
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px;">
            Connect Your Account
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">
            Sign in with your GitSage account in the browser. Your credentials are securely stored in the OS keychain — never in plain text.
          </div>
          <button class="gs-btn gs-btn--primary w-full" id="btn-signin-browser" style="padding:12px;">
            ${svgUser()} Sign In with Browser
          </button>
          <div style="font-size:10px;color:var(--text-muted);margin-top:8px;">
            Opens a secure browser window to authenticate
          </div>
        </div>
      </div>

      <div class="gs-card gs-card--sky" style="margin-bottom:10px;">
        <div class="gs-card__body">
          <div class="gs-section-label" style="color:var(--sky);">Already have an API key?</div>
          <div style="font-size:11px;color:var(--text-muted);margin:6px 0 10px;">
            Paste a <code>gs_...</code> key directly to use GitSage without a full account.
          </div>
          <input type="password" class="gs-form__input" id="quick-api-key" placeholder="Paste gs_... key" />
          <button class="gs-btn gs-btn--ghost w-full" id="btn-quick-key-save" style="margin-top:6px;">
            Save API Key Only
          </button>
        </div>
      </div>

      <div style="text-align:center;margin-top:8px;">
        <button class="gs-btn gs-btn--ghost" data-open="https://gitsage-ai.vercel.app" style="font-size:10px;">
          Create free account ↗
        </button>
      </div>
    </div>`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function buildToast(t: Toast): string {
  const icon = t.type === "success" ? "✅" : t.type === "error" ? "❌" : "ℹ️";
  return `
    <div class="gs-toast gs-toast--${t.type}">
      <span>${icon}</span>
      <span>${escHtml(t.message)}</span>
    </div>`;
}

function showToast(message: string, type: Toast["type"] = "info", ms = 3000): void {
  state.toast = { message, type };
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, ms);
}

// ─── Event Binding ────────────────────────────────────────────────────────────

function bindEvents(): void {
  // Tab switching
  document.querySelectorAll<HTMLButtonElement>(".gs-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab as TabId;
      onTabChange(state.activeTab);
      render();
    });
  });

  // Open external links
  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      vscode.postMessage({ type: "OPEN_EXTERNAL", payload: { url: btn.dataset.open } });
    });
  });

  // ── Commit Tab ──
  on("btn-run-commit",               () => vscode.postMessage({ type: "RUN_COMMIT_COMMAND" }));
  on("btn-goto-account-from-commit", () => { state.activeTab = "account"; render(); });
  on("btn-accept-commit", () => {
    if (!state.commitResult) { return; }
    vscode.postMessage({ type: "COMMIT_ACCEPTED", payload: { message: state.commitResult.commit_message } });
  });
  on("btn-edit-commit", () => {
    if (!state.commitResult) { return; }
    state.editMode = true;
    state.editedMessage = state.commitResult.commit_message;
    render();
  });
  on("btn-cancel-edit", () => { state.editMode = false; render(); });
  on("btn-accept-edited", () => {
    const ta = document.getElementById("edit-message") as HTMLTextAreaElement | null;
    const msg = ta?.value.trim();
    if (!msg) { return; }
    vscode.postMessage({ type: "COMMIT_ACCEPTED", payload: { message: msg } });
  });
  on("btn-copy-scm", () => {
    if (!state.commitResult) { return; }
    vscode.postMessage({ type: "COPY_COMMIT_TO_SCM", payload: { message: state.commitResult.commit_message } });
    showToast("Copied to SCM input box.", "success");
  });
  on("btn-retry-commit", () => {
    state.commitResult = null;
    render();
    setTimeout(() => vscode.postMessage({ type: "RUN_COMMIT_COMMAND" }), 100);
  });
  on("btn-discard-commit", () => { state.commitResult = null; render(); });

  // ── Explain Tab ──
  on("btn-run-explain",              () => vscode.postMessage({ type: "RUN_EXPLAIN_COMMAND" }));
  on("btn-goto-account-from-explain",() => { state.activeTab = "account"; render(); });
  on("btn-retry-explain",            () => {
    state.explainResult = null;
    render();
    setTimeout(() => vscode.postMessage({ type: "RUN_EXPLAIN_COMMAND" }), 100);
  });

  // ── History Tab ──
  on("btn-refresh-history", () => {
    state.historyLoading = true;
    render();
    vscode.postMessage({ type: "GET_GIT_HISTORY" });
  });

  // ── Keys Tab ──
  on("btn-signin-from-keys", () => vscode.postMessage({ type: "TRIGGER_SIGN_IN" }));
  on("btn-generate-key", () => {
    vscode.postMessage({ type: "GENERATE_KEY", payload: { name: "VS Code Key" } });
  });
  on("btn-copy-new-key", () => {
    const val = document.getElementById("reveal-key-value")?.textContent ?? "";
    if (val) {
      copyToClipboard(val);
      showToast("API key copied!", "success");
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-action='revoke']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.keyId;
      if (id) { vscode.postMessage({ type: "REVOKE_KEY", payload: { id } }); }
    });
  });

  // ── Usage Tab ──
  on("btn-signin-from-usage", () => vscode.postMessage({ type: "TRIGGER_SIGN_IN" }));
  on("btn-refresh-usage",     () => vscode.postMessage({ type: "GET_USAGE" }));

  // ── Settings Tab ──
  on("btn-save-settings", () => {
    const commitStyleEl = document.querySelector<HTMLInputElement>("input[name='commitStyle']:checked");
    const autoStagedEl  = document.getElementById("toggle-auto-staged") as HTMLInputElement | null;
    const scmEl         = document.getElementById("toggle-scm")          as HTMLInputElement | null;
    const apiUrlEl      = document.getElementById("input-api-url")       as HTMLInputElement | null;

    vscode.postMessage({
      type: "UPDATE_SETTINGS",
      payload: {
        commitStyle:    commitStyleEl?.value,
        autoStagedCheck: autoStagedEl?.checked,
        scmIntegration:  scmEl?.checked,
        apiBaseUrl:      apiUrlEl?.value?.trim(),
      },
    });
  });

  // ── Account Tab ──
  on("btn-signin-browser", () => vscode.postMessage({ type: "TRIGGER_SIGN_IN" }));
  on("btn-quick-key-save", () => {
    const input = document.getElementById("quick-api-key") as HTMLInputElement | null;
    const key   = input?.value.trim();
    if (!key || !key.startsWith("gs_")) {
      showToast("API keys must start with gs_", "error");
      return;
    }
    vscode.postMessage({ type: "SAVE_API_KEY", payload: { apiKey: key } });
  });
  on("btn-logout",       () => vscode.postMessage({ type: "LOGOUT" }));
  on("btn-open-portal",  () => vscode.postMessage({ type: "OPEN_EXTERNAL", payload: { url: "https://gitsage-ai.vercel.app/dashboard" } }));
  on("btn-goto-keys",    () => { state.activeTab = "keys"; vscode.postMessage({ type: "LIST_KEYS" }); render(); });
}

function on(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener("click", handler);
}

function onTabChange(tab: TabId): void {
  if (tab === "history") {
    if (state.gitHistory.length === 0) {
      state.historyLoading = true;
      vscode.postMessage({ type: "GET_GIT_HISTORY" });
    }
  }
  if (tab === "keys" && state.hasJwt) {
    vscode.postMessage({ type: "LIST_KEYS" });
  }
  if (tab === "usage" && state.hasJwt) {
    vscode.postMessage({ type: "GET_USAGE" });
  }
  if (tab === "settings") {
    vscode.postMessage({ type: "GET_SETTINGS" });
  }
}

// ─── Message Handler (from extension host) ────────────────────────────────────

window.addEventListener("message", (event) => {
  const message = event.data as { type: string; payload?: any };

  switch (message.type) {
    case "INIT_STATE": {
      const p = message.payload;
      state.hasApiKey  = p.hasApiKey;
      state.hasJwt     = p.hasJwt;
      state.authState  = p.authState;
      state.user       = p.user;
      render();
      break;
    }

    case "AUTH_STATE_CHANGED": {
      const p = message.payload;
      if (p.hasApiKey !== undefined) { state.hasApiKey = p.hasApiKey; }
      if (p.hasJwt    !== undefined) { state.hasJwt    = p.hasJwt; }
      if (p.user      !== undefined) { state.user      = p.user; }
      if (!state.hasJwt) { state.user = null; }
      render();
      break;
    }

    case "SWITCH_TAB": {
      const tab = message.payload?.tab as TabId;
      if (tab) {
        state.activeTab = tab;
        onTabChange(tab);
        render();
      }
      break;
    }

    case "LOADING_START": {
      state.loading     = true;
      state.loadingMode = message.payload?.mode ?? null;
      state.loadingStep = "Reading diff context...";
      state.commitResult  = null;
      state.explainResult = null;
      if (message.payload?.mode === "commit")  { state.activeTab = "commit"; }
      if (message.payload?.mode === "explain") { state.activeTab = "explain"; }
      render();
      break;
    }

    case "LOADING_STOP": {
      state.loading     = false;
      state.loadingMode = null;
      render();
      break;
    }

    case "ANALYSIS_STEP": {
      state.loadingStep = message.payload?.step ?? "Processing...";
      const el = document.querySelector<HTMLDivElement>(".gs-loading__text");
      if (el) { el.textContent = state.loadingStep; }
      break;
    }

    case "ANALYSIS_RESULT": {
      state.loading      = false;
      state.loadingMode  = null;
      state.commitResult = message.payload;
      state.activeTab    = "commit";
      state.editMode     = false;
      render();
      requestAnimationFrame(() => {
        setTimeout(() => {
          const bar = document.getElementById("conf-bar");
          if (bar && state.commitResult) {
            bar.style.width = `${state.commitResult.confidence}%`;
          }
        }, 50);
      });
      break;
    }

    case "EXPLAIN_RESULT": {
      state.loading       = false;
      state.loadingMode   = null;
      state.explainResult = message.payload;
      state.activeTab     = "explain";
      render();
      break;
    }

    case "COMMIT_SUCCESS": {
      state.commitResult = null;
      state.activeTab    = "commit";
      render();
      showToast("Commit successful! 🎉", "success");
      break;
    }

    case "COMMIT_ERROR": {
      showToast(`Commit failed: ${message.payload?.error}`, "error");
      break;
    }

    case "KEYS_RESPONSE": {
      state.keys = message.payload?.keys ?? [];
      render();
      break;
    }

    case "KEY_GENERATED": {
      state.newKey = message.payload;
      state.keys.unshift({
        id: message.payload.id,
        name: message.payload.name,
        prefix: message.payload.key?.slice(0, 10) ?? "gs_...",
        createdAt: message.payload.createdAt,
        status: "active",
      });
      state.hasApiKey = true;
      render();
      break;
    }

    case "KEY_REVOKED": {
      const revokedId = message.payload?.id;
      state.keys = state.keys.map(k =>
        k.id === revokedId ? { ...k, status: "revoked" } : k
      ) as ApiKey[];
      render();
      showToast("Key revoked.", "info");
      break;
    }

    case "USAGE_RESPONSE": {
      state.usageStats = message.payload;
      render();
      break;
    }

    case "GIT_HISTORY_RESPONSE": {
      state.gitHistory   = message.payload?.commits ?? [];
      state.historyLoading = false;
      render();
      break;
    }

    case "SETTINGS_RESPONSE": {
      state.settings      = message.payload;
      state.settingsSaved = false;
      render();
      break;
    }

    case "SETTINGS_SAVED": {
      state.settingsSaved = true;
      render();
      setTimeout(() => { state.settingsSaved = false; render(); }, 2500);
      break;
    }
  }
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCommitMessage(msg: string): { type?: string; scope?: string; subject?: string; body?: string } {
  const match = msg.match(/^(\w+)(?:\(([^)]+)\))?: (.+)/);
  if (!match) { return { subject: msg }; }
  const [, type, scope, rest] = match;
  const lines = rest.split("\n");
  const subject = lines[0];
  const body = lines.slice(1).join("\n").trim() || undefined;
  return { type, scope, subject, body };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
  if (n >= 1_000)     { return `${(n / 1_000).toFixed(1)}k`; }
  return String(n);
}

function copyToClipboard(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function svgSparkle(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5h5l-4 3 1.5 5L12 13l-4 3 1.5-5-4-3h5z"/></svg>`;
}
function svgBulb(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.5-1.3 4.7-3.3 6H8.3A7 7 0 0112 2z"/></svg>`;
}
function svgHistory(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
function svgKey(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3"/></svg>`;
}
function svgChart(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
}
function svgSettings(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
}
function svgUser(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}
function svgGit(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>`;
}
function svgCheck(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}
function svgInfo(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}
function svgScope(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 1 1 4.93 19.07"/></svg>`;
}
function svgTrash(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

vscode.postMessage({ type: "GET_AUTH_STATE" });
render();
