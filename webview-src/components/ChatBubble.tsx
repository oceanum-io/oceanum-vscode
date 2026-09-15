// Copyright Oceanum Ltd. Apache 2.0
import React from "react";
import type { Message } from "../responseToMessage";

/**
 * One message in the chat. An answer's blocks are in the notebook, so the
 * bubble shows its text and, under it, only the blocks that did not get there.
 * The answer's code is on the message for the chat history, not for showing:
 * showing it put every block in front of the user twice.
 */
export function ChatBubble({ msg }: { msg: Message }): React.ReactElement {
  return (
    <div className={`chat-message chat-message--${msg.role}`}>
      <span className="chat-role">{msg.role === "user" ? "You" : "AI"}</span>
      <pre className="chat-content">{msg.content}</pre>
      {msg.unplaced && <pre className="chat-code">{msg.unplaced}</pre>}
    </div>
  );
}
