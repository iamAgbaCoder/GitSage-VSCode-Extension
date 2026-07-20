"use strict";
(() => {
  // webview/src/main.ts
  var vscode = acquireVsCodeApi();
  var state = {
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
    loginMode: "login",
    loginError: null,
    toast: null
  };
  function render() {
    const app = document.getElementById("app");
    if (!app) {
      return;
    }
    app.innerHTML = buildHtml();
    bindEvents();
  }
  function buildHtml() {
    return `
    ${buildHeader()}
    ${buildTabs()}
    <div id="tab-content" class="gs-animate-in">
      ${buildTabContent()}
    </div>
    ${state.toast ? buildToast(state.toast) : ""}
  `;
  }
  function buildHeader() {
    return `
    <div class="gs-header">
      <div class="gs-header__logo">
        <div class="gs-header__dot"></div>
        <span class="gs-header__title">GitSage AI</span>
      </div>
      <div class="gs-header__badge">
        ${state.authState === "none" ? "Not connected" : state.user?.name ?? "Connected"}
      </div>
    </div>`;
  }
  var TABS = [
    { id: "commit", label: "Commit", icon: svgSparkle() },
    { id: "explain", label: "Explain", icon: svgBulb() },
    { id: "keys", label: "Keys", icon: svgKey() },
    { id: "account", label: "Account", icon: svgUser() }
  ];
  function buildTabs() {
    return `
    <div class="gs-tabs">
      ${TABS.map((t) => `
        <button class="gs-tab${state.activeTab === t.id ? " active" : ""}" data-tab="${t.id}">
          ${t.icon} ${t.label}
        </button>
      `).join("")}
    </div>`;
  }
  function buildTabContent() {
    switch (state.activeTab) {
      case "commit":
        return buildCommitTab();
      case "explain":
        return buildExplainTab();
      case "keys":
        return buildKeysTab();
      case "account":
        return buildAccountTab();
    }
  }
  function buildCommitTab() {
    if (state.loading && state.loadingMode === "commit") {
      return buildLoadingState(state.loadingStep);
    }
    if (state.commitResult) {
      return buildCommitResult(state.commitResult);
    }
    return buildCommitIdle();
  }
  function buildCommitIdle() {
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
            <div class="gs-section-label text-red">\u26A0 No API Key</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
              Add your GitSage API key to start generating commits.
            </div>
            <button class="gs-btn gs-btn--primary w-full" id="btn-add-key-from-commit">Add API Key</button>
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
  function buildLoadingState(step) {
    return `
    <div class="gs-loading">
      <div style="position:relative;">
        <div class="gs-spinner"></div>
      </div>
      <div class="gs-loading__text">${escHtml(step)}</div>
      <div class="gs-loading__sub">Computing inference...</div>
    </div>`;
  }
  function buildCommitResult(r) {
    const parts = parseCommitMessage(r.commit_message);
    const editContent = state.editMode ? `
    <textarea class="gs-textarea" id="edit-message" rows="3">${escHtml(state.editedMessage)}</textarea>
    <div class="gs-btn-row mt-6">
      <button class="gs-btn gs-btn--primary" id="btn-accept-edited">\u2713 Commit Edited</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-cancel-edit">\u2717 Cancel</button>
    </div>
  ` : `
    <div class="gs-commit-block">
      ${parts.type ? `<span class="gs-commit-block__type">${escHtml(parts.type)}</span>` : ""}
      ${parts.scope ? `<span class="gs-commit-block__paren">(</span><span class="gs-commit-block__scope">${escHtml(parts.scope)}</span><span class="gs-commit-block__paren">):</span>` : ""}
      <span class="gs-commit-block__msg">${escHtml(parts.subject || r.commit_message)}</span>
      ${parts.body ? `<div class="gs-commit-block__body">${escHtml(parts.body)}</div>` : ""}
    </div>
    <div class="gs-btn-row mt-6 gs-btn-row--3">
      <button class="gs-btn gs-btn--primary" id="btn-accept-commit">\u2713 Commit</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-edit-commit">\u270E Edit</button>
      <button class="gs-btn gs-btn--ghost"   id="btn-copy-scm">\u2B06 SCM</button>
    </div>
    <div class="gs-btn-row mt-6">
      <button class="gs-btn gs-btn--ghost w-full" id="btn-retry-commit">\u27F3 Retry</button>
      <button class="gs-btn gs-btn--danger" id="btn-discard-commit">\u2717 Discard</button>
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
        <!-- Confidence bar -->
        <div class="gs-confidence">
          <div class="gs-confidence__header">
            <span>Trust Index</span>
            <span class="gs-confidence__value">${r.confidence}%</span>
          </div>
          <div class="gs-confidence__track">
            <div class="gs-confidence__fill" id="conf-bar" style="width:0%"></div>
          </div>
        </div>

        <!-- Affected files -->
        ${r.stagedFiles && r.stagedFiles.length > 0 ? `
        <div>
          <div class="gs-section-label">Affected Scopes</div>
          <div class="gs-chips">
            ${r.stagedFiles.map((f) => `<span class="gs-chip">${escHtml(f.split("/").pop() ?? f)}</span>`).join("")}
          </div>
        </div>` : ""}

        <!-- Meta row -->
        <div class="gs-meta">
          <span>${escHtml(r.provider)}</span>
          <span class="gs-meta__sep">\xB7</span>
          <span class="font-mono">${escHtml(r.model)}</span>
          <span class="gs-meta__sep">\xB7</span>
          <span>${(r.analysis_time_ms / 1e3).toFixed(1)}s</span>
          ${r.wasTruncated ? `<span class="gs-chip--muted" style="font-size:9px;color:var(--amber);">diff truncated</span>` : ""}
        </div>
        ` : ""}
      </div>
    </div>`;
  }
  function buildExplainTab() {
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
      ` : `
        <button class="gs-btn gs-btn--primary w-full" id="btn-add-key-from-explain" style="margin-top:8px;">
          Add API Key First
        </button>
      `}
    </div>`;
  }
  function buildExplainResult(r) {
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
      <button class="gs-btn gs-btn--ghost w-full" id="btn-retry-explain">\u27F3 Explain Again</button>
    </div>`;
  }
  function buildKeysTab() {
    if (!state.hasJwt) {
      return `
      <div class="gs-empty">
        <div class="gs-empty__icon">${svgKey()}</div>
        <div class="gs-empty__title">Login Required</div>
        <div class="gs-empty__desc">Log in to manage your GitSage API keys and view usage statistics.</div>
        <button class="gs-btn gs-btn--primary w-full" id="btn-go-login" style="margin-top:8px;">
          Go to Account
        </button>
      </div>`;
    }
    return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">

      ${state.newKey ? `
        <div class="gs-key-reveal">
          <div class="gs-key-reveal__label">\u{1F511} New Key \u2014 Copy Now (shown once)</div>
          <div class="gs-key-reveal__value" id="reveal-key-value">${escHtml(state.newKey.key)}</div>
          <div class="gs-key-reveal__note">This key has also been saved as your active extension key.</div>
          <button class="gs-btn gs-btn--ghost w-full" id="btn-copy-new-key" style="margin-top:8px;font-size:10px;">
            Copy to Clipboard
          </button>
        </div>
      ` : ""}

      <button class="gs-btn gs-btn--primary w-full" id="btn-generate-key">
        ${svgKey()} Rotate Master Key
      </button>

      <div class="gs-section-label">Active Keys</div>

      ${state.keys.length === 0 ? `
        <div style="font-size:11px;color:var(--text-muted);text-align:center;padding:16px;">
          No API keys found. Generate one above.
        </div>
      ` : state.keys.map((k) => buildKeyItem(k)).join("")}

      ${state.usageStats ? `
        <div class="gs-section-label">Usage (30d)</div>
        <div class="gs-stats-grid">
          <div class="gs-stat-card">
            <div class="gs-stat-card__label">Requests</div>
            <div class="gs-stat-card__value">${state.usageStats.total_requests ?? 0}</div>
          </div>
          <div class="gs-stat-card">
            <div class="gs-stat-card__label">Tokens</div>
            <div class="gs-stat-card__value">${formatNumber(state.usageStats.total_tokens ?? 0)}</div>
          </div>
        </div>
      ` : ""}
    </div>`;
  }
  function buildKeyItem(k) {
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
  function buildAccountTab() {
    const user = state.user;
    if (state.hasJwt && user) {
      return buildAccountInfo(user);
    }
    return buildAuthForm();
  }
  function buildAccountInfo(user) {
    return `
    <div class="gs-animate-in" style="display:flex;flex-direction:column;gap:10px;">
      <div class="gs-card gs-card--sage">
        <div class="gs-card__body" style="display:flex;flex-direction:column;gap:8px;">
          <div class="gs-section-label">Logged In As</div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(user.name)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escHtml(user.email)}</div>
          <div class="gs-btn-row mt-6">
            <button class="gs-btn gs-btn--ghost" id="btn-logout">Sign Out</button>
            <button class="gs-btn gs-btn--sky"   id="btn-open-portal">Portal \u2197</button>
          </div>
        </div>
      </div>

      ${state.hasApiKey ? `
        <div class="gs-card">
          <div class="gs-card__body">
            <div class="gs-section-label">API Key Status</div>
            <div class="flex items-center gap-6 mt-6">
              <div class="gs-header__dot"></div>
              <span style="font-size:11px;color:var(--sage);font-weight:600;">Key Configured</span>
            </div>
            <button class="gs-btn gs-btn--danger w-full" id="btn-clear-key" style="margin-top:10px;font-size:10px;">
              Clear API Key
            </button>
          </div>
        </div>
      ` : `
        <div class="gs-card gs-card--error">
          <div class="gs-card__body">
            <div class="gs-section-label text-red">No API Key</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
              Add an API key from the Keys tab or paste one below.
            </div>
            <input type="password" class="gs-form__input" id="paste-api-key" placeholder="gs_xxxx..." />
            <button class="gs-btn gs-btn--primary w-full" id="btn-save-pasted-key" style="margin-top:6px;">
              Save Key
            </button>
          </div>
        </div>
      `}

      <div class="gs-card">
        <div class="gs-card__body">
          <div class="gs-section-label">Quick Links</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
            <button class="gs-btn gs-btn--ghost w-full" data-open="https://gitsage-ai.vercel.app/dashboard">
              Dashboard \u2197
            </button>
            <button class="gs-btn gs-btn--ghost w-full" data-open="https://gitsage-ai.vercel.app/docs">
              Get API Key \u2197
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }
  function buildAuthForm() {
    const isLogin = state.loginMode === "login";
    return `
    <div class="gs-animate-in">
      <div class="gs-empty__icon" style="margin:12px auto 16px;">${svgUser()}</div>
      <div style="text-align:center;font-size:14px;font-weight:700;color:var(--text);margin-bottom:16px;">
        ${isLogin ? "Sign in to GitSage" : "Create an Account"}
      </div>

      ${state.loginError ? `<div class="gs-form__error" style="margin-bottom:10px;">${escHtml(state.loginError)}</div>` : ""}

      <div class="gs-form" id="auth-form">
        ${!isLogin ? `
          <div class="gs-form__group">
            <label class="gs-form__label">Full Name</label>
            <input type="text" class="gs-form__input" id="auth-name" placeholder="Alex Coder" autocomplete="name" />
          </div>
        ` : ""}
        <div class="gs-form__group">
          <label class="gs-form__label">Email</label>
          <input type="email" class="gs-form__input" id="auth-email" placeholder="dev@example.com" autocomplete="email" />
        </div>
        <div class="gs-form__group">
          <label class="gs-form__label">Password</label>
          <input type="password" class="gs-form__input" id="auth-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="${isLogin ? "current-password" : "new-password"}" />
        </div>
        <button class="gs-btn gs-btn--primary w-full" id="btn-auth-submit" style="margin-top:4px;">
          ${isLogin ? "Sign In" : "Create Account"}
        </button>
      </div>

      <div class="gs-form__toggle" style="margin-top:12px;">
        ${isLogin ? `No account? <a id="toggle-auth-mode">Sign up free</a>` : `Already have one? <a id="toggle-auth-mode">Sign in</a>`}
      </div>

      <div style="text-align:center;margin-top:16px;">
        <div class="gs-section-label" style="justify-content:center;gap:8px;margin-bottom:8px;">or</div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">Have an API key already?</div>
        <input type="password" class="gs-form__input" id="quick-api-key" placeholder="Paste gs_... key" />
        <button class="gs-btn gs-btn--ghost w-full" id="btn-quick-key-save" style="margin-top:6px;">
          Save API Key Only
        </button>
      </div>

      <div style="text-align:center;margin-top:12px;">
        <button class="gs-btn gs-btn--ghost" data-open="https://gitsage-ai.vercel.app/docs" style="font-size:10px;">
          Get a Free API Key \u2197
        </button>
      </div>
    </div>`;
  }
  function buildToast(t) {
    const icon = t.type === "success" ? "\u2705" : t.type === "error" ? "\u274C" : "\u2139\uFE0F";
    return `
    <div class="gs-toast gs-toast--${t.type}">
      <span>${icon}</span>
      <span>${escHtml(t.message)}</span>
    </div>`;
  }
  function showToast(message, type = "info", ms = 3e3) {
    state.toast = { message, type };
    render();
    setTimeout(() => {
      state.toast = null;
      render();
    }, ms);
  }
  function bindEvents() {
    document.querySelectorAll(".gs-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.tab;
        if (state.activeTab === "keys" && state.hasJwt) {
          vscode.postMessage({ type: "LIST_KEYS" });
          vscode.postMessage({ type: "GET_USAGE" });
        }
        render();
      });
    });
    document.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "OPEN_EXTERNAL", payload: { url: btn.dataset.open } });
      });
    });
    on("btn-run-commit", () => vscode.postMessage({ type: "RUN_COMMIT_COMMAND" }));
    on("btn-add-key-from-commit", () => {
      state.activeTab = "account";
      render();
    });
    on("btn-accept-commit", () => {
      if (!state.commitResult) {
        return;
      }
      vscode.postMessage({ type: "COMMIT_ACCEPTED", payload: { message: state.commitResult.commit_message } });
    });
    on("btn-edit-commit", () => {
      if (!state.commitResult) {
        return;
      }
      state.editMode = true;
      state.editedMessage = state.commitResult.commit_message;
      render();
    });
    on("btn-cancel-edit", () => {
      state.editMode = false;
      render();
    });
    on("btn-accept-edited", () => {
      const ta = document.getElementById("edit-message");
      const msg = ta?.value.trim();
      if (!msg) {
        return;
      }
      vscode.postMessage({ type: "COMMIT_ACCEPTED", payload: { message: msg } });
    });
    on("btn-copy-scm", () => {
      if (!state.commitResult) {
        return;
      }
      vscode.postMessage({ type: "COPY_COMMIT_TO_SCM", payload: { message: state.commitResult.commit_message } });
      showToast("Copied to SCM input box.", "success");
    });
    on("btn-retry-commit", () => {
      state.commitResult = null;
      render();
      setTimeout(() => vscode.postMessage({ type: "RUN_COMMIT_COMMAND" }), 100);
    });
    on("btn-discard-commit", () => {
      state.commitResult = null;
      render();
    });
    on("btn-run-explain", () => vscode.postMessage({ type: "RUN_EXPLAIN_COMMAND" }));
    on("btn-add-key-from-explain", () => {
      state.activeTab = "account";
      render();
    });
    on("btn-retry-explain", () => {
      state.explainResult = null;
      render();
      setTimeout(() => vscode.postMessage({ type: "RUN_EXPLAIN_COMMAND" }), 100);
    });
    on("btn-go-login", () => {
      state.activeTab = "account";
      render();
    });
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
    document.querySelectorAll("[data-action='revoke']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.keyId;
        if (id) {
          vscode.postMessage({ type: "REVOKE_KEY", payload: { id } });
        }
      });
    });
    on("toggle-auth-mode", () => {
      state.loginMode = state.loginMode === "login" ? "signup" : "login";
      state.loginError = null;
      render();
    });
    on("btn-auth-submit", () => handleAuthSubmit());
    on("btn-quick-key-save", () => {
      const input = document.getElementById("quick-api-key");
      const key = input?.value.trim();
      if (!key || !key.startsWith("gs_")) {
        showToast("API keys must start with gs_", "error");
        return;
      }
      vscode.postMessage({ type: "SAVE_API_KEY", payload: { apiKey: key } });
    });
    on("btn-logout", () => vscode.postMessage({ type: "LOGOUT" }));
    on("btn-open-portal", () => vscode.postMessage({ type: "OPEN_EXTERNAL", payload: { url: "https://gitsage-ai.vercel.app/dashboard" } }));
    on("btn-clear-key", () => vscode.postMessage({ type: "LOGOUT" }));
    on("btn-save-pasted-key", () => {
      const input = document.getElementById("paste-api-key");
      const key = input?.value.trim();
      if (!key) {
        return;
      }
      vscode.postMessage({ type: "SAVE_API_KEY", payload: { apiKey: key } });
    });
  }
  function on(id, handler) {
    document.getElementById(id)?.addEventListener("click", handler);
  }
  function handleAuthSubmit() {
    const email = document.getElementById("auth-email")?.value?.trim() ?? "";
    const password = document.getElementById("auth-password")?.value ?? "";
    const name = document.getElementById("auth-name")?.value?.trim() ?? "";
    if (!email || !password) {
      state.loginError = "Email and password are required.";
      render();
      return;
    }
    state.loginError = null;
    state.loading = true;
    render();
    if (state.loginMode === "login") {
      vscode.postMessage({ type: "LOGIN", payload: { email, password } });
    } else {
      if (!name) {
        state.loginError = "Full name is required.";
        state.loading = false;
        render();
        return;
      }
      vscode.postMessage({ type: "SIGNUP", payload: { email, password, name } });
    }
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "INIT_STATE": {
        const p = message.payload;
        state.hasApiKey = p.hasApiKey;
        state.hasJwt = p.hasJwt;
        state.authState = p.authState;
        state.user = p.user;
        render();
        break;
      }
      case "AUTH_STATE_CHANGED": {
        const p = message.payload;
        if (p.hasApiKey !== void 0) {
          state.hasApiKey = p.hasApiKey;
        }
        if (p.hasJwt !== void 0) {
          state.hasJwt = p.hasJwt;
        }
        if (p.user !== void 0) {
          state.user = p.user;
        }
        render();
        break;
      }
      case "LOADING_START": {
        state.loading = true;
        state.loadingMode = message.payload?.mode ?? null;
        state.loadingStep = "Reading diff context...";
        state.commitResult = null;
        state.explainResult = null;
        if (message.payload?.mode === "commit") {
          state.activeTab = "commit";
        }
        if (message.payload?.mode === "explain") {
          state.activeTab = "explain";
        }
        render();
        break;
      }
      case "LOADING_STOP": {
        state.loading = false;
        state.loadingMode = null;
        render();
        break;
      }
      case "ANALYSIS_STEP": {
        state.loadingStep = message.payload?.step ?? "Processing...";
        const el = document.querySelector(".gs-loading__text");
        if (el) {
          el.textContent = state.loadingStep;
        }
        break;
      }
      case "ANALYSIS_RESULT": {
        state.loading = false;
        state.loadingMode = null;
        state.commitResult = message.payload;
        state.activeTab = "commit";
        state.editMode = false;
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
        state.loading = false;
        state.loadingMode = null;
        state.explainResult = message.payload;
        state.activeTab = "explain";
        render();
        break;
      }
      case "COMMIT_SUCCESS": {
        state.commitResult = null;
        state.activeTab = "commit";
        render();
        showToast("Commit successful! \u{1F389}", "success");
        break;
      }
      case "COMMIT_ERROR": {
        showToast(`Commit failed: ${message.payload?.error}`, "error");
        break;
      }
      case "LOGIN_RESPONSE":
      case "SIGNUP_RESPONSE": {
        state.loading = false;
        const p = message.payload;
        if (p.success) {
          state.hasJwt = true;
          state.user = p.user;
          state.loginError = null;
          render();
          showToast(`Welcome, ${p.user?.name ?? ""}!`, "success");
          vscode.postMessage({ type: "LIST_KEYS" });
          vscode.postMessage({ type: "GET_USAGE" });
        } else {
          state.loginError = p.error ?? "Authentication failed";
          render();
        }
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
          status: "active"
        });
        state.hasApiKey = true;
        render();
        break;
      }
      case "KEY_REVOKED": {
        const revokedId = message.payload?.id;
        state.keys = state.keys.map(
          (k) => k.id === revokedId ? { ...k, status: "revoked" } : k
        );
        render();
        showToast("Key revoked.", "info");
        break;
      }
      case "USAGE_RESPONSE": {
        state.usageStats = message.payload;
        render();
        break;
      }
    }
  });
  function escHtml(str) {
    return (str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function parseCommitMessage(msg) {
    const match = msg.match(/^(\w+)(?:\(([^)]+)\))?: (.+)/);
    if (!match) {
      return { subject: msg };
    }
    const [, type, scope, rest] = match;
    const lines = rest.split("\n");
    const subject = lines[0];
    const body = lines.slice(1).join("\n").trim() || void 0;
    return { type, scope, subject, body };
  }
  function formatNumber(n) {
    if (n >= 1e3) {
      return `${(n / 1e3).toFixed(1)}k`;
    }
    return String(n);
  }
  function copyToClipboard(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  function svgSparkle() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5h5l-4 3 1.5 5L12 13l-4 3 1.5-5-4-3h5z"/></svg>`;
  }
  function svgBulb() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.5-1.3 4.7-3.3 6H8.3A7 7 0 0112 2z"/></svg>`;
  }
  function svgKey() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3"/></svg>`;
  }
  function svgUser() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  function svgGit() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>`;
  }
  function svgCheck() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  function svgInfo() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }
  function svgScope() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 1 1 4.93 19.07"/></svg>`;
  }
  function svgTrash() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`;
  }
  vscode.postMessage({ type: "GET_AUTH_STATE" });
  render();
})();
//# sourceMappingURL=panel.js.map
