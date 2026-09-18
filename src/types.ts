// Copyright Oceanum Ltd. Apache 2.0

export interface IDatasource {
  id: string;
  label: string;
  datasource: string;
  description: string;
  variables?: string[];
  geofilter?: Record<string, unknown>;
  timefilter?: { times: [string, string] };
  spatialref?: string;
}

export interface IWorkspaceSpec {
  id: string;
  name: string;
  data: IDatasource[];
}

/** One thing the backend asks us to place in the editor. */
export interface Block {
  type: "code" | "markdown";
  content: string;
}

/**
 * What `/api/chat` answers with: one message, plus anything to place.
 *
 * This replaced a discriminated union of text/code/markdown responses
 * (OCE-173). The union was exclusive, so the backend could not send a markdown
 * table describing a dataset AND the query that produced it -- it had to drop
 * one half. `message` is what goes in the chat panel; `blocks` is what goes in
 * the notebook or editor, in order.
 *
 * `message` is always present now; on the old markdown variant it was optional.
 */
export interface OceanumResponse {
  message: string;
  blocks: Block[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * What the agent is doing, from a streamed response's `status` event (OCE-175)
 * -- or, for `running` and `placing`, what the notebook is doing, which the
 * extension reports itself. `tool` names the lookup when `phase` is `tool`.
 */
export interface Progress {
  phase: string;
  tool?: string;
}

/**
 * What one code cell did when it ran, in the shape `/api/chat/observe` takes.
 * `message` is the agent's explanation for the response that carried the code.
 */
export interface ObservedRun {
  code: string;
  status: "ok" | "error";
  stdout: string;
  error: string | null;
  message: string;
}

/** A notebook stored on Oceanum.io, as the Notebooks tab lists it. */
export interface StoredNotebook {
  id: string;
  name: string;
  description: string | null;
  modified: string;
}

/** What the Notebooks tab shows. */
export type NotebooksState =
  | { state: "signed-out" }
  | {
      state: "ready";
      email: string;
      mine: StoredNotebook[];
      shared: StoredNotebook[];
    }
  | { state: "error"; email: string; message: string };

// Messages sent from sidebar webview → extension host
export type WebviewToExtMessage =
  | { command: "insert-datasource"; datasource: IDatasource }
  | { command: "open-datamesh" }
  | { command: "set-token" }
  | { command: "get-token-status" }
  | { command: "get-notebook-context" }
  | { command: "chat-request"; prompt: string; chatHistory: ChatMessage[] }
  | { command: "chat-stop" }
  // Start a new conversation: end any run in flight WITHOUT reporting it, and
  // pin the notebook in the active tab (if any) as the conversation's context.
  | { command: "chat-new" }
  // The Notebooks tab: list what is stored, open, share, rename or delete one, save the
  // active notebook, and sign in or out (which decides whether there is anything to list).
  | { command: "notebooks-refresh" }
  | { command: "notebook-open"; id: string }
  | { command: "notebook-share"; id: string; name: string }
  | { command: "notebook-rename"; id: string; name: string }
  | { command: "notebook-delete"; id: string; name: string }
  | { command: "notebook-save" }
  // Whether the active tab is a notebook, which is what "Save current notebook" acts on.
  | { command: "get-active-notebook" }
  | { command: "sign-in" }
  | { command: "sign-out" };

// Messages sent from extension host → sidebar webview
export type ExtToWebviewMessage =
  | { command: "workspace-update"; spec: IWorkspaceSpec }
  | { command: "token-status"; hasToken: boolean }
  | { command: "active-notebook"; isNotebook: boolean }
  | { command: "notebooks"; notebooks: NotebooksState }
  | { command: "notebook-context"; cells: string[] }
  | { command: "chat-response"; response: OceanumResponse }
  // The blocks of the latest response that did not reach the notebook. The
  // chat does not repeat what the notebook has, so it shows only these.
  | { command: "chat-unplaced"; blocks: Block[] }
  // A request can carry several responses (one per round), so the end of the
  // run is its own message; the webview stays "thinking" until one of these.
  | { command: "chat-done" }
  | { command: "chat-stopped" }
  | { command: "chat-error"; message: string }
  // The notebook the current conversation is pinned to, by file name, or null
  // when it has none. Sent whenever the pin changes.
  | { command: "chat-context"; notebook: string | null }
  // What the current run is doing, for the panel to show instead of a static
  // "Thinking…". The panel clears it itself when the run ends.
  | { command: "chat-status"; progress: Progress };
