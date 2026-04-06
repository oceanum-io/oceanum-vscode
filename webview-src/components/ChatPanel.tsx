// Copyright Oceanum Ltd. Apache 2.0
import React, { useEffect, useRef, useState } from "react";
import { vscode } from "../vscode";
import type {
  ChatMessage,
  ExtToWebviewMessage,
  OceanumResponse,
} from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
  code?: string;
}

function responseToMessage(response: OceanumResponse): Message {
  if (response.type === "code") {
    return {
      role: "assistant",
      content: response.message,
      code: response.code,
    };
  }
  if (response.type === "markdown") {
    return { role: "assistant", content: response.message ?? response.content };
  }
  return { role: "assistant", content: response.message };
}

export function ChatPanel(): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtToWebviewMessage;
      if (msg.command === "chat-response") {
        setMessages((prev) => [...prev, responseToMessage(msg.response)]);
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
    vscode.postMessage({ command: "chat-request", prompt, chatHistory });
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
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="oceanum-empty">
            Ask Oceanum AI to query and analyse Datamesh data. Generated code is
            inserted into your active notebook.
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
        <button
          className="chat-send"
          onClick={submit}
          disabled={loading || !input.trim()}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
