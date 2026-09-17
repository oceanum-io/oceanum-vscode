// Copyright Oceanum Ltd. Apache 2.0
// Re-export shared types for use in the webview bundle.
// (Cannot import from src/ — different TS configs and build targets.)

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

/** What the agent -- or, for `running` and `placing`, the notebook -- is doing. */
export interface Progress {
  phase: string;
  tool?: string;
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

export type ExtToWebviewMessage =
  | { command: "workspace-update"; spec: IWorkspaceSpec }
  | { command: "token-status"; hasToken: boolean }
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
  // What the current run is doing, shown instead of a static "Thinking…".
  | { command: "chat-status"; progress: Progress };
