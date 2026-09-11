// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { isStaleRunMessage } from "./runMessages";
import type { ExtToWebviewMessage } from "./types";

const run: ExtToWebviewMessage[] = [
  { command: "chat-response", response: { message: "late", blocks: [] } },
  { command: "chat-done" },
  { command: "chat-stopped" },
  { command: "chat-error", message: "boom" },
];

const panelState: ExtToWebviewMessage[] = [
  { command: "chat-context", notebook: "a.ipynb" },
  { command: "chat-context", notebook: null },
  { command: "token-status", hasToken: true },
  { command: "notebook-context", cells: [] },
];

describe("isStaleRunMessage", () => {
  it("drops every run message between New chat and the next request", () => {
    // Above all "Stopped.": it belongs to the conversation New chat threw away.
    for (const msg of run) {
      expect(isStaleRunMessage(msg, false)).toBe(true);
    }
  });

  it("keeps run messages once a request has been sent", () => {
    for (const msg of run) {
      expect(isStaleRunMessage(msg, true)).toBe(false);
    }
  });

  it("never drops panel state, even right after New chat", () => {
    // New chat's own reply is a chat-context: dropping it would leave the new
    // conversation without its label.
    for (const msg of panelState) {
      expect(isStaleRunMessage(msg, false)).toBe(false);
    }
  });
});
