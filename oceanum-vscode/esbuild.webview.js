// Copyright Oceanum Ltd. Apache 2.0
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["webview-src/index.tsx"],
    bundle: true,
    outfile: "out/sidebar.js",
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    sourcemap: !production,
    minify: production,
    define: {
      "process.env.NODE_ENV": production ? '"production"' : '"development"',
    },
  });

  if (watch) {
    await ctx.watch();
    console.log("[webview] watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("[webview] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
