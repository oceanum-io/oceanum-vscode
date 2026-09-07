// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { CODE_BLOCK_SEPARATOR, responseToMessage } from "./responseToMessage";

describe("responseToMessage", () => {
  it("shows the message and no code block when there is nothing to place", () => {
    const message = responseToMessage({
      message: "Hs is significant wave height.",
      blocks: [],
    });

    expect(message).toEqual({
      role: "assistant",
      content: "Hs is significant wave height.",
      code: undefined,
    });
  });

  it("shows the message alongside a single code block", () => {
    const message = responseToMessage({
      message: "This queries wave height.",
      blocks: [{ type: "code", content: "ds = query()" }],
    });

    expect(message.content).toBe("This queries wave height.");
    expect(message.code).toBe("ds = query()");
  });

  it("joins several code blocks rather than showing only one", () => {
    // The old contract could carry exactly one, so a naive port keeps `[0]` and
    // silently loses every later step (OCE-173).
    const message = responseToMessage({
      message: "Fetch it, then resample.",
      blocks: [
        { type: "code", content: "ds = fetch()" },
        { type: "code", content: "ds.resample(time='1D')" },
      ],
    });

    expect(message.code).toBe(
      `ds = fetch()${CODE_BLOCK_SEPARATOR}ds.resample(time='1D')`,
    );
  });

  it("keeps the message when the response also carries markdown", () => {
    // The union's markdown variant had an OPTIONAL message, so the panel used
    // to fall back to rendering the document itself. `message` is mandatory
    // now, and the markdown goes to the notebook, not the chat bubble.
    const message = responseToMessage({
      message: "Twelve years of hourly Hs.",
      blocks: [{ type: "markdown", content: "| var | units |" }],
    });

    expect(message.content).toBe("Twelve years of hourly Hs.");
    expect(message.code).toBeUndefined();
  });

  it("takes only the code from a mixed response, in order", () => {
    const message = responseToMessage({
      message: "Table, then the query.",
      blocks: [
        { type: "markdown", content: "| var | units |" },
        { type: "code", content: "ds = query()" },
        { type: "markdown", content: "# Notes" },
        { type: "code", content: "ds.mean()" },
      ],
    });

    expect(message.code).toBe(`ds = query()${CODE_BLOCK_SEPARATOR}ds.mean()`);
    expect(message.code).not.toContain("| var | units |");
  });
});
