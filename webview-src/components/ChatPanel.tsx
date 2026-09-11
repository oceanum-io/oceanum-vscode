// Copyright Oceanum Ltd. Apache 2.0
import React, { useEffect, useRef, useState } from "react";
import { vscode } from "../vscode";
import type { ChatMessage, ExtToWebviewMessage } from "../types";
import { type Message, responseToMessage } from "../responseToMessage";
import { isStaleRunMessage } from "../runMessages";

export function ChatPanel(): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  // The notebook this conversation is pinned to, as the extension reports it:
  // undefined until the conversation starts, null when it has none.
  const [context, setContext] = useState<string | null | undefined>(undefined);
  // False from New chat until the next request; see isStaleRunMessage.
  const acceptRun = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtToWebviewMessage;
      if (isStaleRunMessage(msg, acceptRun.current)) {
        return;
      }
      if (msg.command === "chat-context") {
        setContext(msg.notebook);
      } else if (msg.command === "chat-response") {
        // One bubble per round. The run may still be placing, running and
        // observing cells, so this does not end "loading": Stop must stay
        // available until "chat-done".
        setMessages((prev) => [...prev, responseToMessage(msg.response)]);
      } else if (msg.command === "chat-done") {
        setLoading(false);
      } else if (msg.command === "chat-stopped") {
        // The user pressed Stop. A message, not an error: nothing went wrong.
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Stopped." },
        ]);
        setLoading(false);
      } else if (msg.command === "chat-error") {
        setError(msg.message);
        setLoading(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const submit = () => {
    const prompt = input.trim();
    if (!prompt || loading) return;

    const chatHistory: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.code
        ? `${m.content}\n\`\`\`python\n${m.code}\n\`\`\``
        : m.content,
    }));

    setHistory((h) => [...h, prompt]);
    setHistoryIndex(-1);
    setSavedInput("");
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setLoading(true);
    acceptRun.current = true;
    vscode.postMessage({ command: "chat-request", prompt, chatHistory });
  };

  // Clear the conversation and start another, pinned to whichever notebook is
  // active now. The extension ends a run in flight without reporting it: its
  // "Stopped." belongs to the conversation being thrown away. The prompt
  // history (up/down arrow) is kept -- it is input recall, not conversation.
  const newChat = () => {
    acceptRun.current = false;
    setMessages([]);
    setInput("");
    setError(null);
    setLoading(false);
    setHistoryIndex(-1);
    setSavedInput("");
    vscode.postMessage({ command: "chat-new" });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      if (historyIndex === -1) {
        setSavedInput(input);
        setHistoryIndex(history.length - 1);
        setInput(history[history.length - 1]);
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setInput(history[historyIndex - 1]);
      }
      return;
    }
    if (e.key === "ArrowDown" && historyIndex !== -1) {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setInput(history[historyIndex + 1]);
      } else {
        setHistoryIndex(-1);
        setInput(savedInput);
      }
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <span className="chat-context" title={context ?? undefined}>
          {context === undefined
            ? ""
            : context === null
              ? "No notebook in context"
              : `Context: ${context}`}
        </span>
        <button
          className="chat-new"
          onClick={newChat}
          title="Clear this conversation and start a new one in the notebook in the active tab, or in a new notebook if that tab is not one"
        >
          New chat
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="oceanum-empty">
            Ask Oceanum AI to query and analyse Datamesh data. Answers go into
            this chat&apos;s notebook: the one in the active tab when the chat
            starts, or a new one.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <span className="chat-role">
              {msg.role === "user" ? "You" : "AI"}
            </span>
            <pre className="chat-content">{msg.content}</pre>
            {msg.code && <pre className="chat-code">{msg.code}</pre>}
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message--assistant">
            <span className="chat-role">AI</span>
            <span className="chat-loading">Thinking…</span>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={endRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          rows={3}
          placeholder="Ask Oceanum AI… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        {loading ? (
          <button
            className="chat-send"
            onClick={() => vscode.postMessage({ command: "chat-stop" })}
            title="Stop the current response"
          >
            Stop
          </button>
        ) : (
          <button
            className="chat-send"
            onClick={submit}
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
