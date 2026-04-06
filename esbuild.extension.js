// Copyright Oceanum Ltd. Apache 2.0
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "out/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    sourcemap: !production,
    minify: production,
  });

  if (watch) {
    await ctx.watch();
    console.log("[extension] watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("[extension] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
