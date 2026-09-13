// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { describeProgress } from "./progress";

describe("describeProgress", () => {
  it("names the lookup the agent stopped to do", () => {
    expect(describeProgress({ phase: "tool", tool: "search_catalog" })).toBe(
      "Searching the catalogue…",
    );
    expect(
      describeProgress({ phase: "tool", tool: "get_datasource_info" }),
    ).toBe("Reading dataset details…");
  });

  it("falls back to Thinking when there is no progress yet", () => {
    // A backend that does not stream, or a proxy that buffered the stream
    // away, degrades to exactly what the panel said before.
    expect(describeProgress(null)).toBe("Thinking…");
  });

  it("does not leak the internal name of a tool it has not been taught", () => {
    expect(
      describeProgress({ phase: "tool", tool: "some_new_internal_tool" }),
    ).toBe("Looking something up…");
    expect(describeProgress({ phase: "tool" })).toBe("Looking something up…");
  });

  it("reads a new phase as progress rather than as a blank", () => {
    expect(describeProgress({ phase: "something_new" })).toBe("Working…");
  });
});

describe("phases the extension reports about the notebook", () => {
  // Everything else names something the AGENT is doing. These two are the
  // notebook's turn: without them the agent's last phase would stay on screen
  // while the user's own code runs -- a worse claim than "Thinking…".

  it("says the code is running", () => {
    expect(describeProgress({ phase: "running" })).toBe("Running the code…");
  });

  it("says the code is being added when nothing will run", () => {
    expect(describeProgress({ phase: "placing" })).toBe(
      "Adding the code to the notebook…",
    );
  });

  it("never claims the agent is working while the notebook is", () => {
    for (const phase of ["running", "placing"]) {
      expect(describeProgress({ phase })).not.toBe("Thinking…");
      expect(describeProgress({ phase })).not.toBe("Working…");
    }
  });
});
