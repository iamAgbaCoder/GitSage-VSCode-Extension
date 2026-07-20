/**
 * GitSage AI — Git Diff Provider
 *
 * Retrieves staged diff via `git diff --cached`, applies sensitive-file
 * filtering (mirrors the CLI's behaviour), and truncates to ~3,000 tokens.
 */

import { exec } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

// ─── Sensitive file patterns ─────────────────────────────────────────────────
// Mirrors GitSage CLI's filter list (git/diff.py)

const SENSITIVE_PATTERNS = [
  /\.env(\..+)?$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /secret/i,
  /credential/i,
  /password/i,
  /private[\s_-]?key/i,
  /auth[\s_-]?token/i,
  /\.aws\/credentials/i,
  /\.ssh\//i,
  /id_rsa/i,
  /id_dsa/i,
  /id_ecdsa/i,
  /id_ed25519/i,
];

// ~3,000 tokens ≈ 12,000 characters
const MAX_DIFF_CHARS = 12_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiffResult {
  diff: string;
  stagedFiles: string[];
  filteredFiles: string[];
  isEmpty: boolean;
  wasTruncated: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isSensitiveFile(filePath: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function runGit(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // Non-zero exit in git is often just "no staged files" — return empty
        resolve(stdout || "");
      } else {
        resolve(stdout);
      }
    });
  });
}

export function filterSensitiveFiles(rawDiff: string): {
  cleanedDiff: string;
  filteredFiles: string[];
} {
  // Split on "diff --git" boundaries
  const chunks = rawDiff.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  const filtered: string[] = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) { continue; }
    // Extract the file path from the header
    const match = chunk.match(/^diff --git a\/(.+?) b\//m);
    const filePath = match ? match[1] : "";

    if (filePath && isSensitiveFile(filePath)) {
      filtered.push(filePath);
    } else {
      kept.push(chunk);
    }
  }

  return {
    cleanedDiff: kept.join(""),
    filteredFiles: filtered,
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

export class DiffProvider {
  private cwd: string;

  constructor(workspacePath?: string) {
    this.cwd =
      workspacePath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
      process.cwd();
  }

  /** Returns the current workspace root. */
  getWorkspaceRoot(): string {
    return this.cwd;
  }

  /**
   * Retrieves staged diff (`git diff --cached`), filters sensitive files,
   * and truncates to MAX_DIFF_CHARS before returning.
   */
  async getStagedDiff(): Promise<DiffResult> {
    // 1. Get staged files list
    const stagedFilesRaw = await runGit("git diff --cached --name-only", this.cwd);
    const stagedFiles = stagedFilesRaw
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    if (stagedFiles.length === 0) {
      return {
        diff: "",
        stagedFiles: [],
        filteredFiles: [],
        isEmpty: true,
        wasTruncated: false,
      };
    }

    // 2. Get raw diff
    const rawDiff = await runGit("git diff --cached", this.cwd);

    // 3. Filter sensitive files
    const { cleanedDiff, filteredFiles } = filterSensitiveFiles(rawDiff);

    // 4. Truncate
    let finalDiff = cleanedDiff;
    let wasTruncated = false;
    if (finalDiff.length > MAX_DIFF_CHARS) {
      finalDiff = finalDiff.slice(0, MAX_DIFF_CHARS) + "\n\n[...diff truncated for context limit...]";
      wasTruncated = true;
    }

    const nonSensitiveFiles = stagedFiles.filter((f) => !isSensitiveFile(f));

    return {
      diff: finalDiff,
      stagedFiles: nonSensitiveFiles,
      filteredFiles,
      isEmpty: finalDiff.trim().length === 0,
      wasTruncated,
    };
  }

  /**
   * Retrieves diff for the current file (unstaged + staged).
   * Used by the "Explain Changes" command on the active editor.
   */
  async getFileDiff(filePath: string): Promise<string> {
    const relative = path.relative(this.cwd, filePath);
    const raw = await runGit(
      `git diff HEAD -- "${relative}"`,
      this.cwd
    );
    const { cleanedDiff } = filterSensitiveFiles(raw);
    return cleanedDiff.slice(0, MAX_DIFF_CHARS);
  }

  /**
   * Checks if the workspace is a Git repository.
   */
  async isGitRepository(): Promise<boolean> {
    try {
      const result = await runGit("git rev-parse --is-inside-work-tree", this.cwd);
      return result.trim() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Gets the current branch name.
   */
  async getBranchName(): Promise<string | undefined> {
    try {
      const branch = await runGit("git branch --show-current", this.cwd);
      return branch.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Performs the actual git commit.
   */
  async performCommit(message: string): Promise<{ success: boolean; error?: string }> {
    try {
      await runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, this.cwd);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }
}

// Singleton
let _diffProvider: DiffProvider | undefined;

export function getDiffProvider(): DiffProvider {
  if (!_diffProvider) {
    _diffProvider = new DiffProvider();
  }
  return _diffProvider;
}

export function resetDiffProvider(): void {
  _diffProvider = undefined;
}
