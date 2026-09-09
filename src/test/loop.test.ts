// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { runChatLoop, type LoopDeps } from "../ai/loop";
import type { ObservedRun, OceanumResponse } from "../types";

const code = (content: string) => ({ type: "code" as const, content });
const reply = (message: string, ...blocks: OceanumResponse["blocks"]) => ({
  message,
  blocks,
});

/** A fake notebook: records placements; one ok run per code block unless scripted to fail. */
function fakeDeps(
  first: OceanumResponse,
  observations: OceanumResponse[],
  failing: string[] = [],
) {
  const placed: { blocks: string[]; autoRun: boolean }[] = [];
  const observed: ObservedRun[][] = [];
  const said: string[] = [];
  const pending = [...observations];

  const deps: LoopDeps = {
    route: async () => first,
    observe: async (_p, _h, runs) => {
      observed.push(runs.map((r) => ({ ...r })));
      const next = pending.shift();
      if (!next) {
        throw new Error("observe called more times than scripted");
      }
      return next;
    },
    place: async (response, autoRun) => {
      placed.push({ blocks: response.blocks.map((b) => b.content), autoRun });
      const runs: ObservedRun[] = autoRun
        ? response.blocks
            .filter((b) => b.type === "code")
            .map((b) => ({
              code: b.content,
              status: failing.includes(b.content) ? "error" : "ok",
              stdout: `ran ${b.content}`,
              error: failing.includes(b.content) ? "Boom" : null,
              message: "",
            }))
        : [];
      return { runs };
    },
    say: (r) => said.push(r.message),
  };
  return { deps, placed, observed, said };
}

const opts = (over: Partial<Parameters<typeof runChatLoop>[3]> = {}) => ({
  autoRunCode: false,
  iterate: false,
  maxRounds: 5,
  signal: new AbortController().signal,
  ...over,
});

describe("runChatLoop: the three workflows", () => {
  it("workflow 3: places blocks and does not run them", async () => {
    const { deps, placed, observed, said } = fakeDeps(
      reply("Here.", code("a()")),
      [],
    );
    const outcome = await runChatLoop("q", [], deps, opts());
    expect(outcome).toBe("done");
    expect(placed).toEqual([{ blocks: ["a()"], autoRun: false }]);
    expect(observed).toEqual([]);
    expect(said).toEqual(["Here."]);
  });

  it("workflow 1: places and runs, but never observes", async () => {
    const { deps, placed, observed } = fakeDeps(
      reply("Here.", code("a()")),
      [],
    );
    await runChatLoop("q", [], deps, opts({ autoRunCode: true }));
    expect(placed[0].autoRun).toBe(true);
    expect(observed).toEqual([]);
  });

  it("workflow 2: runs, observes, places the follow-up, stops when no code comes back", async () => {
    const { deps, placed, observed, said } = fakeDeps(
      reply("Step one.", code("a()")),
      [reply("Step two.", code("b()")), reply("Done: the peak is in January.")],
    );
    await runChatLoop(
      "q",
      [],
      deps,
      opts({ autoRunCode: true, iterate: true }),
    );
    expect(placed.map((p) => p.blocks)).toEqual([["a()"], ["b()"], []]);
    // Every observation carries EVERY run so far, with the agent's message attached.
    expect(observed.map((o) => o.map((r) => r.code))).toEqual([
      ["a()"],
      ["a()", "b()"],
    ]);
    expect(observed[1][0].message).toBe("Step one.");
    expect(observed[1][1].message).toBe("Step two.");
    expect(said).toEqual([
      "Step one.",
      "Step two.",
      "Done: the peak is in January.",
    ]);
  });

  it("iterate without autoRun is inert", async () => {
    const { deps, observed } = fakeDeps(reply("Here.", code("a()")), []);
    await runChatLoop("q", [], deps, opts({ iterate: true }));
    expect(observed).toEqual([]);
  });

  it("a failed run is observed so the agent can repair it", async () => {
    const { deps, observed } = fakeDeps(
      reply("Try.", code("bad()")),
      [reply("Fixed.", code("good()")), reply("Done.")],
      ["bad()"],
    );
    await runChatLoop(
      "q",
      [],
      deps,
      opts({ autoRunCode: true, iterate: true }),
    );
    expect(observed[0][0]).toMatchObject({
      code: "bad()",
      status: "error",
      error: "Boom",
    });
    expect(observed[1][1]).toMatchObject({ code: "good()", status: "ok" });
  });
});

describe("runChatLoop: limits", () => {
  it("keeps observing up to maxRounds, then stops even if the agent keeps sending code", async () => {
    // The cap is a safety net checked AFTER each round, so with maxRounds 3
    // the loop observes after rounds 1, 2 and 3 and refuses a fourth. Checking
    // before the observe would skip the server's own at-cap explanation turn,
    // leaving the last cell executed but never explained.
    const forever = Array.from({ length: 10 }, (_, i) =>
      reply(`More ${i}.`, code(`s${i}()`)),
    );
    const { deps, observed } = fakeDeps(reply("Start.", code("s()")), forever);
    await runChatLoop(
      "q",
      [],
      deps,
      opts({ autoRunCode: true, iterate: true, maxRounds: 3 }),
    );
    expect(observed).toHaveLength(3);
  });

  it("Stop between rounds halts the loop and reports stopped", async () => {
    const controller = new AbortController();
    const { deps, observed } = fakeDeps(reply("Start.", code("s()")), [
      reply("More.", code("t()")),
    ]);
    const original = deps.place;
    deps.place = async (r, a, s) => {
      const out = await original(r, a, s);
      controller.abort();
      return out;
    };
    const outcome = await runChatLoop(
      "q",
      [],
      deps,
      opts({ autoRunCode: true, iterate: true, signal: controller.signal }),
    );
    expect(outcome).toBe("stopped");
    expect(observed).toEqual([]);
  });

  it("hands place the loop's signal, so Stop can reach a running cell", async () => {
    const controller = new AbortController();
    const { deps } = fakeDeps(reply("Start.", code("s()")), []);
    const seen: AbortSignal[] = [];
    const original = deps.place;
    deps.place = async (r, a, signal) => {
      seen.push(signal);
      return original(r, a, signal);
    };
    await runChatLoop(
      "q",
      [],
      deps,
      opts({ autoRunCode: true, signal: controller.signal }),
    );
    expect(seen).toEqual([controller.signal]);
  });

  it("Stop during the first request returns stopped without placing anything", async () => {
    const controller = new AbortController();
    const { deps, placed } = fakeDeps(reply("Start.", code("s()")), []);
    deps.route = async () => {
      controller.abort();
      return reply("Start.", code("s()"));
    };
    const outcome = await runChatLoop(
      "q",
      [],
      deps,
      opts({ signal: controller.signal }),
    );
    expect(outcome).toBe("stopped");
    expect(placed).toEqual([]);
  });
});
