// Copyright Oceanum Ltd. Apache 2.0
import React, { useEffect, useState } from "react";
import { vscode } from "./vscode";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { ChatPanel } from "./components/ChatPanel";
import { TokenPrompt } from "./components/TokenPrompt";
import { NotebooksPanel } from "./components/NotebooksPanel";
import type {
  ExtToWebviewMessage,
  IWorkspaceSpec,
  NotebooksState,
} from "./types";
import "./styles/sidebar.css";

// The same three, in the same order, as the Oceanum panel in JupyterLab (oceanumlab).
type Tab = "notebooks" | "workspace" | "chat";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("notebooks");
  const [notebooks, setNotebooks] = useState<NotebooksState | null>(null);
  const [hasToken, setHasToken] = useState(false);
  // Whether the tab on top is a notebook, so the sidebar can say when there is nothing
  // for "Save current notebook" to act on.
  const [activeIsNotebook, setActiveIsNotebook] = useState(false);
  const [workspaceSpec, setWorkspaceSpec] = useState<IWorkspaceSpec | null>(
    null,
  );

  useEffect(() => {
    vscode.postMessage({ command: "get-token-status" });
    vscode.postMessage({ command: "notebooks-refresh" });
    vscode.postMessage({ command: "get-active-notebook" });

    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtToWebviewMessage;
      if (msg.command === "token-status") setHasToken(msg.hasToken);
      if (msg.command === "workspace-update") setWorkspaceSpec(msg.spec);
      if (msg.command === "notebooks") setNotebooks(msg.notebooks);
      if (msg.command === "active-notebook") setActiveIsNotebook(msg.isNotebook);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // A stored notebook belongs to someone, so saving one needs a sign-in.
  const signedIn = notebooks !== null && notebooks.state !== "signed-out";
  // The AI tab waits for a sign-in, as it does in oceanumlab. It also waits for the
  // Datamesh token, which is the only credential the chat here can send: without one the
  // tab would be there to be clicked and nothing behind it would work.
  const showChat = signedIn && hasToken;

  return (
    <div className="oceanum-sidebar">
      <header className="oceanum-header">
        <span className="oceanum-title">Oceanum.io</span>
        <div className="oceanum-tabs">
          <button
            className={tab === "notebooks" ? "active" : ""}
            onClick={() => setTab("notebooks")}
          >
            Notebooks
          </button>
          <button
            className={tab === "workspace" ? "active" : ""}
            onClick={() => setTab("workspace")}
          >
            Datamesh
          </button>
          {showChat && (
            <button
              className={tab === "chat" ? "active" : ""}
              onClick={() => setTab("chat")}
            >
              Oceanum AI
            </button>
          )}
        </div>
      </header>

      {/* The Datamesh token is what the Datamesh and AI tabs run on. Notebooks runs on
          the sign-in instead, and says so itself, so the prompt stays off that tab. */}
      {!hasToken && tab !== "notebooks" && <TokenPrompt />}


      {/* Both panes stay mounted; the inactive one is hidden via CSS so its
          local state (chat history, input, scroll) survives tab switches. */}
      <div className="oceanum-tab-pane" hidden={tab !== "notebooks"}>
        <NotebooksPanel
          notebooks={notebooks}
          canSave={signedIn && activeIsNotebook}
        />
      </div>
      <div className="oceanum-tab-pane" hidden={tab !== "workspace"}>
        <WorkspacePanel spec={workspaceSpec} />
      </div>
      {showChat && (
        <div className="oceanum-tab-pane" hidden={tab !== "chat"}>
          <ChatPanel />
        </div>
      )}
    </div>
  );
}
