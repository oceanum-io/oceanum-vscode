// Copyright Oceanum Ltd. Apache 2.0
import type { OceanumResponse } from "./types";

export interface Message {
  role: "user" | "assistant";
  content: string;
  code?: string;
}

/**
 * The same separator the backend uses to join a multi-block answer into one
 * runnable unit (`OceanumResponse.code` in app/models.py), so the chat panel
 * and the notebook show the same code the same way.
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
 * A response can carry several code blocks, so they are joined rather than
 * one being picked. Markdown blocks are not shown here: they are placed in the
 * notebook by the extension host, and repeating them in the chat would show
 * the same document twice.
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
