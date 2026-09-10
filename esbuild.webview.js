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
      console.log("[webview] build started");
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
      console.log("[webview] build finished");
    });
  },
};

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
    plugins: [problemMatcherPlugin],
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
