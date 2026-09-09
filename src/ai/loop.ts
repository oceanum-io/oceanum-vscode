// Copyright Oceanum Ltd. Apache 2.0
import type {
  Block,
  ChatMessage,
  ObservedRun,
  OceanumResponse,
} from "../types";

/** What placing a response reports back: what ran, if anything did. */
export interface PlacedResponse {
  runs: ObservedRun[];
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
  place(response: OceanumResponse, autoRun: boolean): Promise<PlacedResponse>;
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
 * to observe. Rounds end when a response carries no code, at `maxRounds`
 * (the server strips code past its own cap), or on Stop.
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
    const placed = await deps.place(response, options.autoRunCode);
    // The agent's explanation travels with the code it explains.
    for (const run of placed.runs) {
      runs.push({ ...run, message: response.message });
    }

    if (signal.aborted) {
      return "stopped";
    }
    if (!options.autoRunCode || !options.iterate) {
      return "done";
    }
    if (!hasCode(response.blocks) || placed.runs.length === 0) {
      return "done";
    }
    if (round >= options.maxRounds) {
      return "done";
    }

    response = await deps.observe(prompt, history, runs, signal);
    if (signal.aborted) {
      return "stopped";
    }
  }
}

function hasCode(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === "code");
}
