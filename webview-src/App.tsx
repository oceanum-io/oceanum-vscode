// Copyright Oceanum Ltd. Apache 2.0
import React, { useEffect, useState } from "react";
import { vscode } from "./vscode";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { ChatPanel } from "./components/ChatPanel";
import { TokenPrompt } from "./components/TokenPrompt";
import type { ExtToWebviewMessage, IWorkspaceSpec } from "./types";
import "./styles/sidebar.css";

type Tab = "workspace" | "chat";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("workspace");
  const [hasToken, setHasToken] = useState(false);
  const [workspaceSpec, setWorkspaceSpec] = useState<IWorkspaceSpec | null>(
    null,
  );

  useEffect(() => {
    vscode.postMessage({ command: "get-token-status" });

    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtToWebviewMessage;
      if (msg.command === "token-status") setHasToken(msg.hasToken);
      if (msg.command === "workspace-update") setWorkspaceSpec(msg.spec);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <div className="oceanum-sidebar">
      <header className="oceanum-header">
        <span className="oceanum-title">Oceanum.io</span>
        <div className="oceanum-tabs">
          <button
            className={tab === "workspace" ? "active" : ""}
            onClick={() => setTab("workspace")}
          >
            Workspace
          </button>
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            AI Chat
          </button>
        </div>
      </header>

      {!hasToken && <TokenPrompt />}

      {tab === "workspace" && <WorkspacePanel spec={workspaceSpec} />}
      {tab === "chat" && hasToken && <ChatPanel />}
    </div>
  );
}
