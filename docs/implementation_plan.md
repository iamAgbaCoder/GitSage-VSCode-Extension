# GitSage AI — VS Code Extension Implementation Plan

A native VS Code extension that brings GitSage's full intelligence suite (AI-powered commit generation, diff analysis, "Three Pillars" explanations, and API key management) directly into the editor sidebar — compatible with VS Code, Cursor, Windsurf, and any VS Code-fork IDE.

---

## Background & Research Summary

| Source                | Key Findings                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI (`gitsage.py`)    | Backend base URL: `https://gitsage-api.up.railway.app`. Auth via `X-API-Key` header. Endpoints: `POST /v1/intelligence/analyze`, `POST /v1/intelligence/commit`, `POST /v1/intelligence/explain`. Keys stored in `~/.gitsage_auth`. |
| Backend Schemas       | `AnalyzeRequest { diff, context?, style? }` → `AnalyzeResponse { commit_message, explanation, confidence, analysis_time_ms, provider, model }`                                                                                      |
| Docs UI Design System | Dark theme (`#020617` bg), green-sage primary (`hsl(142.1 76.2% 36.3%)`), sky-blue accent, Outfit + Fira Code fonts, glassmorphism cards, animated confidence bars, grain-texture overlays.                                         |
| CommitSimulator.tsx   | Flow: idle → analyzing (step-by-step loading text) → done (commit message + confidence bar + affected scopes). Mirrors exactly what our extension panel should do.                                                                  |

---

## Architecture Overview

```
GitSage VSCode Extension
├── Extension Host (Node.js)
│   ├── src/extension.ts          — Activation, command registration, SCM integration
│   ├── src/api/gitsageClient.ts  — HTTP client (fetch) for /v1/intelligence/* + /v1/auth/*
│   ├── src/auth/keyManager.ts    — Secure key storage (vscode.SecretStorage)
│   ├── src/git/diffProvider.ts   — git diff --cached via child_process
│   ├── src/providers/            — WebviewViewProvider implementations
│   └── src/commands/             — Command handlers (commit, explain, auth)
│
└── Webview (React-like HTML/JS/CSS)
    └── media/
        ├── panel.html            — Sidebar panel shell
        ├── panel.css             — GitSage design system (replicated from docs)
        └── panel.js              — Compiled/bundled UI logic
```

**IDE Compatibility Strategy:** The extension uses only the standard `vscode` API with no Cursor/Windsurf-specific code. VS Code forks all implement the same extension API — the extension marketplace target is `"engines": { "vscode": "^1.85.0" }` which covers all major forks.

---

## Proposed Changes

### Phase 1 — Project Scaffolding

#### [NEW] `package.json`

Core extension manifest. Declares:

- `"publisher": "gitsage"`, `"displayName": "GitSage AI"`
- Activation events: `onStartupFinished`, `onCommand:gitsage.*`
- Contributes: sidebar view (`gitsage-panel`), commands (`gitsage.commit`, `gitsage.explain`, `gitsage.auth`, `gitsage.showPanel`)
- SCM: registers as SCM Quick Diff source
- Dependencies: none (uses Node built-ins + VS Code API only, zero runtime npm deps for lean bundle)
- Dev dependencies: `@types/vscode`, `typescript`, `esbuild`, `@vscode/test-electron`

#### [NEW] `tsconfig.json`

TypeScript config targeting `ES2022`, `commonjs`, strict mode.

#### [NEW] `.vscodeignore`

Excludes `node_modules`, `src`, `*.ts` from the packaged VSIX.

#### [NEW] `esbuild.js`

Single-file bundler script. Bundles `src/extension.ts` → `out/extension.js` for the extension host, and bundles `webview/src/main.ts` → `media/panel.js` for the webview.

---

### Phase 2 — Extension Host Core

#### [NEW] `src/extension.ts`

Main entry point.

- `activate(context)`: Registers all commands, sidebar panel provider, SCM provider
- `deactivate()`: Cleans up
- Checks for an active Git workspace on activation; shows "Set up API key" prompt if none found

#### [NEW] `src/api/gitsageClient.ts`

TypeScript HTTP client using Node's `https` module (no extra deps).

```typescript
// Key methods:
analyze(diff: string, context?: string, style?: string): Promise<AnalyzeResponse>
commit(diff: string, context?: string): Promise<CommitResponse>
explain(diff: string): Promise<ExplainResponse>
login(email: string, password: string): Promise<AuthResponse>
signup(email: string, password: string, name: string): Promise<AuthResponse>
getMe(jwtToken: string): Promise<UserProfile>
listApiKeys(jwtToken: string): Promise<ApiKey[]>
generateApiKey(jwtToken: string, name: string): Promise<NewApiKey>
revokeApiKey(jwtToken: string, id: string): Promise<void>
getUsageStats(jwtToken: string, period?: string): Promise<UsageStats>
```

- Base URL: `https://gitsage-api.up.railway.app` (configurable via `gitsage.apiBaseUrl` setting)
- 45s timeout, proper error classes: `AuthenticationError`, `RateLimitError`, `NetworkError`

#### [NEW] `src/auth/keyManager.ts`

Wraps `vscode.SecretStorage` for API key + JWT token persistence:

```typescript
saveApiKey(key: string): Promise<void>
getApiKey(): Promise<string | undefined>
clearApiKey(): Promise<void>
saveJwtToken(token: string): Promise<void>
getJwtToken(): Promise<string | undefined>
```

#### [NEW] `src/git/diffProvider.ts`

Retrieves staged diff via `child_process.exec('git diff --cached')`.

- Filters sensitive files (`.env`, `*.key`, `*secret*`, `*credential*`) — mirroring CLI behavior
- Truncates diff to ~12,000 chars (≈3,000 tokens) before sending
- Returns `{ diff: string, stagedFiles: string[], isEmpty: boolean }`

#### [NEW] `src/commands/commitCommand.ts`

Handler for `gitsage.commit`:

1. Get staged diff via `diffProvider`
2. If empty, prompt user to stage files
3. Call `gitsageClient.analyze()`
4. Open the webview panel and post `{ type: 'ANALYSIS_RESULT', data }` message
5. Listen for `{ type: 'COMMIT_ACCEPTED', message }` from webview → runs `git commit -m "<message>"` via `child_process`

#### [NEW] `src/commands/explainCommand.ts`

Handler for `gitsage.explain`:

1. Get diff (staged or current file selection)
2. Call `gitsageClient.explain()`
3. Post `{ type: 'EXPLAIN_RESULT', data }` to panel

#### [NEW] `src/commands/authCommand.ts`

Handler for `gitsage.auth`:

1. Shows `gitsage.setApiKey` quick input (paste token flow)

2. OR opens the webview's Login/Signup tab

#### [NEW] `src/providers/panelProvider.ts`

`WebviewViewProvider` for the sidebar panel (view ID: `gitsage-panel`).

- Loads `media/panel.html` with CSP allowing `nonce`-based inline scripts
- Bidirectional message bus: Extension ↔ Webview
- Injects VS Code theme variables as CSS custom properties so the panel matches the editor theme

#### [NEW] `src/providers/scmProvider.ts`

Registers as a VS Code SCM (Source Control) input box provider. When the user clicks "✨ Generate with AI" in the Git SCM view, it triggers the commit command and pastes the result into the SCM input box.

---

### Phase 3 — Webview UI (GitSage Design System)

#### [NEW] `webview/src/main.ts`

Single TypeScript entry for the webview. Manages:

- View state machine: `auth` | `panel` | `loading` | `result`
- Message handling from extension host
- DOM manipulation and animation

#### [NEW] `media/panel.css`

Full GitSage design system for the VS Code sidebar:

- CSS variables matching the docs: `--sage`, `--obsidian`, `--sky`, `--destructive`
- Glassmorphism `.glass` class
- Confidence bar animations (`@keyframes fill-bar`)
- Fira Code for commit messages, Outfit/system-ui for UI labels
- Green glow effects (`box-shadow: 0 0 20px rgba(34,197,94,0.15)`)
- Compact layout adapted for the ~280–350px sidebar width

#### [NEW] `media/panel.html`

The single-page shell. Contains tabs rendered via JS:

1. **`#tab-commit`** — "Analyze & Commit" tab (the primary flow)
2. **`#tab-explain`** — "Explain Changes" tab
3. **`#tab-keys`** — "API Keys" tab (list, generate, revoke)
4. **`#tab-auth`** — "Account / Login" tab (hidden when authenticated)

---

### Phase 4 — Panel UI Screens (JS-driven)

#### Commit Tab UI Flow (mirrors `CommitSimulator.tsx`)

```
[Staged Files Summary]
  • 3 files staged (auth.py, router.go, tests/)

[ANALYZE INTELLIGENCE ▶]  ← Primary CTA button (sage green gradient)

         ↓ (on click)

[Spinner + Step labels]   ← "Reading diff context...", "Computing confidence..."

         ↓ (on API return)

┌─ Intelligence Report ──────────────── ✓ Verified ─┐
│ feat(auth): add JWT token expiry validation         │
│ ─────────────────────────────────────────────────── │
│ Trust Index ████████████░░ 91%                      │
│ Affected: auth.py • router.go                       │
│                                                     │
│ Provider: Groq · llama3-70b  ·  1.2s               │
└─────────────────────────────────────────────────────┘

[✓ Accept & Commit]  [✎ Edit]  [✗ Discard]  [⟳ Retry]
```

#### Explain Tab UI (Three Pillars Report)

```
┌─ What Changed ──────────────────────────────────────┐
│ Added token expiration checking inside JWT middleware│
└─────────────────────────────────────────────────────┘
┌─ Why It Matters ────────────────────────────────────┐
│ Prevents replay attacks, secures long-lived sessions│
└─────────────────────────────────────────────────────┘
┌─ Reach & Scope ─────────────────────────────────────┐
│ auth.py  •  middleware/router.go                    │
│ Impact Level: 🔴 High                               │
└─────────────────────────────────────────────────────┘
```

#### API Keys Tab

- Table of active/revoked keys with masked prefix `gs_7f...`
- "Rotate Master Key" button → calls `POST /v1/api-keys`
- Copy-to-clipboard with one-time reveal
- Key ID copy fallback with warning toast

#### Auth Tab (Login/Signup)

- Email + password form
- Signup vs Login toggle
- On success: stores JWT, transitions to main panel
- "Paste API Key directly" shortcut input (for CLI-only users)

---

### Phase 5 — Configuration & Settings

#### `package.json` → `contributes.configuration`

| Setting                   | Type    | Default                              | Description                          |
| ------------------------- | ------- | ------------------------------------ | ------------------------------------ |
| `gitsage.apiBaseUrl`      | string  | `https://gitsage-api.up.railway.app` | Override the backend URL             |
| `gitsage.commitStyle`     | enum    | `conventional`                       | `conventional`, `simple`, `emoji`    |
| `gitsage.autoStagedCheck` | boolean | `true`                               | Alert when no files are staged       |
| `gitsage.scmIntegration`  | boolean | `true`                               | Show "Generate with AI" in SCM input |

---

### Phase 6 — Testing & Packaging

#### [NEW] `src/test/suite/extension.test.ts`

- Test: extension activates without error
- Test: `diffProvider` filters `.env` files
- Test: `keyManager` stores and retrieves keys using mock `SecretStorage`
- Test: `gitsageClient` constructs correct request headers

#### [NEW] `.github/workflows/release.yml`

CI pipeline: `npm run compile` → `npm test` → `vsce package` → upload VSIX artifact.

---

## Extension Package Structure (Final)

```
GitSage-VSCode-Extension/
├── .vscode/
│   └── launch.json              — Debug config (Extension Development Host)
├── media/
│   ├── gitsage-icon.png         — Extension icon (128x128)
│   ├── panel.html               — Webview shell
│   ├── panel.css                — Full design system
│   └── panel.js                 — Bundled webview JS (output of esbuild)
├── src/
│   ├── extension.ts
│   ├── api/gitsageClient.ts
│   ├── auth/keyManager.ts
│   ├── git/diffProvider.ts
│   ├── commands/
│   │   ├── commitCommand.ts
│   │   ├── explainCommand.ts
│   │   └── authCommand.ts
│   ├── providers/
│   │   ├── panelProvider.ts
│   │   └── scmProvider.ts
│   └── test/suite/
│       ├── index.ts
│       └── extension.test.ts
├── webview/
│   └── src/main.ts
├── .agents/
│   └── context.json
├── .vscodeignore
├── esbuild.js
├── package.json
└── tsconfig.json
```

---

## Open Questions

> [!IMPORTANT]
> **Q1: Backend URL** — Should `gitsage.apiBaseUrl` default to `https://gitsage-api.up.railway.app` (from CLI config) or should we expose this as a required config setting? If the Railway URL changes, we need an update path.

> [!IMPORTANT]
> **Q2: JWT vs API Key flow** — The CLI uses only API keys (`X-API-Key` header from `~/.gitsage_auth`). The web dashboard uses JWTs. Should the extension support **both** (JWT for Portal features, X-API-Key for intelligence calls) or **API Key only** (simpler, mirrors CLI behavior)? My recommendation: support both, JWT for the full panel (keys management, usage stats), API-key-only path for quick setup.

> [!NOTE]
> **Q3: SCM Input Box Integration** — Injecting the commit message directly into VS Code's built-in Git SCM input box is clean but requires the `vscode.git` extension API. Should we depend on it, or use a separate "Commit via Extension" button that calls `git commit` directly through a terminal?

> [!NOTE]
> **Q4: Marketplace** — Will the extension be published to the VS Code Marketplace under the `gitsage` publisher? If yes, I need to confirm the publisher ID so it's embedded in `package.json` now (changing it after publish breaks the extension ID).

---

## Verification Plan

### Automated Tests

```bash
npm run compile          # TypeScript must build with zero errors
npm test                 # Run @vscode/test-electron suite
```

### Manual Verification

1. Press **F5** in VS Code to launch the Extension Development Host
2. Open a Git repository, stage some files, run `GitSage: Analyze & Commit` from the Command Palette
3. Verify the sidebar panel opens, animation plays, commit message appears with confidence bar
4. Accept the commit → verify `git log` shows the commit
5. Open the Keys tab, generate a key, verify it copies to clipboard
6. Test on Cursor IDE by installing the `.vsix` directly
