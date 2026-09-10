// Copyright Oceanum Ltd. Apache 2.0
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Prints the markers the .vscode/tasks.json background problem matcher waits for,
// so VS Code knows when a watch build has started and finished.
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[extension] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        if (location) {
          console.error(
            `${location.file}:${location.line}:${location.column}: error: ${text}`
          );
        } else {
          console.error(`error: ${text}`);
        }
      });
      console.log("[extension] build finished");
    });
  },
};

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
    plugins: [problemMatcherPlugin],
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
