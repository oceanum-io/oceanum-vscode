// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi } from "vitest";

// The real module calls acquireVsCodeApi() as it loads, which only exists in a
// VS Code webview.
vi.mock("../vscode", () => ({ vscode: { postMessage: vi.fn() } }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "./ChatPanel";

/** The classes of every element enclosing the first element with `cls`. */
function ancestorsOf(html: string, cls: string): string[] {
  const stack: string[] = [];
  for (const [, closing, attrs] of html.matchAll(/<(\/?)\w+([^>]*)>/g)) {
    if (closing) {
      stack.pop();
      continue;
    }
    const classes = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (classes.split(" ").includes(cls)) {
      return [...stack];
    }
    stack.push(classes);
  }
  throw new Error(`no element with class ${cls}`);
}

describe("ChatPanel", () => {
  const html = renderToStaticMarkup(createElement(ChatPanel));

  it("keeps the input in the conversation, just under the latest answer", () => {
    // Pinned below the conversation, the input sat at the bottom of the
    // panel, a screen away from an answer at the top.
    expect(ancestorsOf(html, "chat-input-area")).toContain("chat-messages");
  });

  it("puts the input at the top of an empty conversation", () => {
    expect(html.indexOf('class="chat-input-area"')).toBeLessThan(
      html.indexOf('class="oceanum-empty"'),
    );
    expect(ancestorsOf(html, "chat-input-area")).toEqual([
      "chat-panel",
      "chat-messages",
    ]);
  });
});
