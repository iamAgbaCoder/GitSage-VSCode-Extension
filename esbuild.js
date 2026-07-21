const esbuild = require("esbuild");
const path = require("path");

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["webview/src/main.ts"],
  bundle: true,
  outfile: "media/panel.js",
  format: "iife",
  platform: "browser",
  target: ["chrome114"],
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const testConfig = {
  entryPoints: ["src/test/runTest.ts"],
  bundle: true,
  outfile: "out/test/runTest.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const testSuiteConfig = {
  entryPoints: ["src/test/suite/index.ts", "src/test/suite/extension.test.ts"],
  bundle: true,
  outdir: "out/test/suite",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: "info",
};

async function main() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    const testCtx = await esbuild.context(testConfig);
    const testSuiteCtx = await esbuild.context(testSuiteConfig);
    await Promise.all([
      extCtx.watch(),
      webCtx.watch(),
      testCtx.watch(),
      testSuiteCtx.watch(),
    ]);
    console.log("👁  Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
      esbuild.build(testConfig),
      esbuild.build(testSuiteConfig),
    ]);
    console.log("✅ Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
