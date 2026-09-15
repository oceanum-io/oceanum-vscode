// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatBubble } from "./ChatBubble";
import type { Message } from "../responseToMessage";

const render = (msg: Message) =>
  renderToStaticMarkup(createElement(ChatBubble, { msg }));

describe("ChatBubble", () => {
  it("shows an answer's text but not its code, which is in the notebook", () => {
    // Showing the code here too put every block in front of the user twice.
    const html = render({
      role: "assistant",
      content: "This queries wave height.",
      code: "ds = query()",
    });

    expect(html).toContain("This queries wave height.");
    expect(html).not.toContain("ds = query()");
    expect(html).not.toContain("chat-code");
  });

  it("shows the blocks that did not reach the notebook under the text", () => {
    const html = render({
      role: "assistant",
      content: "This queries wave height.",
      code: "ds = query()",
      unplaced: "ds = query()",
    });

    expect(html).toContain(
      '<pre class="chat-content">This queries wave height.</pre>' +
        '<pre class="chat-code">ds = query()</pre>',
    );
  });

  it("says who said it", () => {
    expect(render({ role: "user", content: "hi" })).toContain(
      '<span class="chat-role">You</span>',
    );
    expect(render({ role: "assistant", content: "hello" })).toContain(
      '<span class="chat-role">AI</span>',
    );
  });
});
