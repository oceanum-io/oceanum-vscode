// Copyright Oceanum Ltd. Apache 2.0
import type { ExtToWebviewMessage } from "./types";

// Messages that belong to a chat run, as opposed to panel state.
const RUN_MESSAGES = new Set<ExtToWebviewMessage["command"]>([
  "chat-response",
  "chat-done",
  "chat-stopped",
  "chat-error",
]);

/**
 * Whether the panel should drop `msg`: it belongs to a chat run, and the panel
 * is not accepting run messages -- New chat has been pressed and no request
 * has been sent since.
 *
 * A message from the run New chat replaced can already be on its way when the
 * button is pressed. The extension stops posting for that run, but cannot
 * recall what it has already sent, and it must not land in the new
 * conversation. Panel state such as the notebook context always applies.
 */
export function isStaleRunMessage(
  msg: ExtToWebviewMessage,
  acceptingRun: boolean,
): boolean {
  return !acceptingRun && RUN_MESSAGES.has(msg.command);
}
