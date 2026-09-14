// Copyright Oceanum Ltd. Apache 2.0
import type { Block, OceanumResponse } from "./types";

export interface Message {
  role: "user" | "assistant";
  content: string;
  /** The answer's code, sent back as chat history; not shown in the bubble. */
  code?: string;
  /** Blocks that did not reach the notebook, shown under the bubble's text. */
  unplaced?: string;
}

/**
 * The same separator the backend uses to join a multi-block answer into one
 * runnable unit (`OceanumResponse.code` in app/models.py), so the chat history
 * gives the agent its earlier code the way it wrote it.
 */
export const CODE_BLOCK_SEPARATOR = "\n\n# --- follow-up ---\n\n";

/**
 * Turn a backend response into the bubble the chat panel renders.
 *
 * `message` is what the agent SAYS and is always present, so it is always the
 * bubble text. This used to branch over a `type` discriminator, and its
 * markdown branch rendered the document itself when `message` was absent --
 * there is nothing to fall back from now (OCE-173).
 *
 * The blocks are not shown here: the extension host places every one of them
 * in the notebook, and repeating them in the chat showed each one twice. It
 * reports any the notebook did not take, which `withUnplaced` then shows.
 *
 * The code is still kept, joined rather than one block being picked, because
 * the chat history sent with the next question carries it.
 */
export function responseToMessage(response: OceanumResponse): Message {
  const code = response.blocks
    .filter((b) => b.type === "code")
    .map((b) => b.content)
    .join(CODE_BLOCK_SEPARATOR);

  return {
    role: "assistant",
    content: response.message,
    code: code || undefined,
  };
}

/**
 * Show `blocks` -- ones the notebook did not take -- under the latest answer.
 *
 * The extension reports them right after it places that answer's blocks, so
 * the latest answer is the one they came with. Without this they would be
 * nowhere: not in the notebook, and no longer repeated in the chat.
 */
export function withUnplaced(messages: Message[], blocks: Block[]): Message[] {
  const latest = messages.map((m) => m.role).lastIndexOf("assistant");
  const unplaced = blocks.map((b) => b.content).join("\n\n");
  return messages.map((m, i) => (i === latest ? { ...m, unplaced } : m));
}
