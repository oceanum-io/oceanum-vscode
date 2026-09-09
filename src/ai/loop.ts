// Copyright Oceanum Ltd. Apache 2.0
import type { ChatMessage, ObservedRun, OceanumResponse } from "../types";

/**
 * What placing a response reports back: what ran, if anything did. The
 * agent's message is attached by the loop, which is the one that has it.
 */
export interface PlacedResponse {
  runs: Omit<ObservedRun, "message">[];
}

/** The pieces the loop needs, injected so it is testable without VS Code. */
export interface LoopDeps {
  route(
    prompt: string,
    history: ChatMessage[],
    signal: AbortSignal,
  ): Promise<OceanumResponse>;
  observe(
    prompt: string,
    history: ChatMessage[],
    runs: ObservedRun[],
    signal: AbortSignal,
  ): Promise<OceanumResponse>;
  /** Stop must reach the cells, not only the requests, so the signal goes in. */
  place(
    response: OceanumResponse,
    autoRun: boolean,
    signal: AbortSignal,
  ): Promise<PlacedResponse>;
  /** Each round's response, as it happens. */
  say(response: OceanumResponse): void;
}

export interface LoopOptions {
  /** Run code cells as they are placed. Workflow 1; required for 2. */
  autoRunCode: boolean;
  /** Send each run's output back and place what comes next. Workflow 2. */
  iterate: boolean;
  /** Client-side mirror of the server's EXECUTE_MAX_ROUNDS. */
  maxRounds: number;
  signal: AbortSignal;
}

export type LoopOutcome = "done" | "stopped";

/**
 * One prompt, start to finish, under the two switches.
 *
 * The loop lives in the client because the CLIENT owns the kernel: only it
 * can run a cell and read what came back. The server sees one turn at a time
 * through `/api/chat/observe`.
 *
 *   autoRunCode off              -> place blocks, stop.           (workflow 3)
 *   autoRunCode on, iterate off  -> place, run, stop.             (workflow 1)
 *   autoRunCode on, iterate on   -> place, run, observe, repeat.  (workflow 2)
 *
 * `iterate` without `autoRunCode` is inert: nothing ran, so there is nothing
 * to observe. Rounds end when a response carries no code, or on Stop.
 *
 * `maxRounds` is a safety net, not the real cap. The server's
 * EXECUTE_MAX_ROUNDS is what ends a chain: at its cap it answers WITHOUT code,
 * explaining the last run, and that response ends the loop here because
 * nothing runs. So the client must keep observing up to and including the
 * server's cap, or the last cell executes with no explanation. `maxRounds`
 * only stops a client talking to a server that keeps sending code, and is
 * checked after each round rather than before the observe for that reason.
 * Same shape as oceanumlab's loop, so the two notebook clients behave alike.
 */
export async function runChatLoop(
  prompt: string,
  history: ChatMessage[],
  deps: LoopDeps,
  options: LoopOptions,
): Promise<LoopOutcome> {
  const { signal } = options;
  const runs: ObservedRun[] = [];

  let response = await deps.route(prompt, history, signal);
  if (signal.aborted) {
    return "stopped";
  }

  for (let round = 1; ; round++) {
    deps.say(response);
    const placed = await deps.place(response, options.autoRunCode, signal);
    // The agent's explanation travels with the code it explains.
    for (const run of placed.runs) {
      runs.push({ ...run, message: response.message });
    }

    if (signal.aborted) {
      return "stopped";
    }
    // Nothing ran this round -- iterate off, autoRun off, or a response with
    // no code -- so there is nothing to observe. One check covers all three:
    // `place` reports runs only for code it actually executed.
    if (!options.iterate || placed.runs.length === 0) {
      return "done";
    }
    if (round > options.maxRounds) {
      return "done";
    }

    response = await deps.observe(prompt, history, runs, signal);
    if (signal.aborted) {
      return "stopped";
    }
  }
}
