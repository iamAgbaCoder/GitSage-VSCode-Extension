import * as assert from "assert";

suite("GitSage Extension Test Suite", () => {
  test("DiffProvider: filters sensitive files from raw diff", async () => {
    const { filterSensitiveFiles } = await import("../../git/diffProvider");

    const rawDiff = [
      "diff --git a/.env b/.env",
      "@@ -0,0 +1 @@",
      "+SECRET_KEY=abc123",
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -1 +1 @@",
      "+console.log(\"hi\")",
    ].join("\n");

    const result = filterSensitiveFiles(rawDiff);

    assert.deepStrictEqual(result.filteredFiles, [".env"]);
    assert.ok(result.cleanedDiff.includes("src/app.ts"));
    assert.ok(!result.cleanedDiff.includes(".env"));
  });

  test("DiffProvider: sensitive filename detection matches common secret paths", async () => {
    const { isSensitiveFile } = await import("../../git/diffProvider");

    assert.strictEqual(isSensitiveFile(".env"), true);
    assert.strictEqual(isSensitiveFile("config/private_key.pem"), true);
    assert.strictEqual(isSensitiveFile("src/app.ts"), false);
  });

  test("KeyManager: stores and retrieves API key", async () => {
    const stored = new Map<string, string>();
    const mockSecrets = {
      get: async (key: string) => stored.get(key),
      store: async (key: string, value: string) => {
        stored.set(key, value);
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
      onDidChange: { event: () => ({}) },
    } as any;

    const { KeyManager } = await import("../../auth/keyManager");
    const km = new KeyManager(mockSecrets);

    await km.saveApiKey("gs_test_key_123");
    assert.strictEqual(await km.getApiKey(), "gs_test_key_123");

    await km.clearApiKey();
    assert.strictEqual(await km.getApiKey(), undefined);
  });

  test("KeyManager: getAuthState returns the strongest available state", async () => {
    const stored = new Map<string, string>();
    const mockSecrets = {
      get: async (key: string) => stored.get(key),
      store: async (key: string, value: string) => {
        stored.set(key, value);
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
    } as any;

    const { KeyManager } = await import("../../auth/keyManager");
    const km = new KeyManager(mockSecrets);

    assert.strictEqual(await km.getAuthState(), "none");

    await km.saveApiKey("gs_test");
    assert.strictEqual(await km.getAuthState(), "apiKey");

    await km.saveJwtToken("jwt.token.here");
    assert.strictEqual(await km.getAuthState(), "full");
  });

  test("GitSageClient: builds against configured base URL", async () => {
    const { GitSageClient } = await import("../../api/gitsageClient");
    const client = new GitSageClient("https://gitsage-api.up.railway.app");

    assert.ok(client);
  });
});
