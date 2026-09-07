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

// Messages sent from sidebar webview → extension host
export type WebviewToExtMessage =
  | { command: "insert-datasource"; datasource: IDatasource }
  | { command: "open-datamesh" }
  | { command: "set-token" }
  | { command: "get-token-status" }
  | { command: "get-notebook-context" }
  | { command: "chat-request"; prompt: string; chatHistory: ChatMessage[] };

// Messages sent from extension host → sidebar webview
export type ExtToWebviewMessage =
  | { command: "workspace-update"; spec: IWorkspaceSpec }
  | { command: "token-status"; hasToken: boolean }
  | { command: "notebook-context"; cells: string[] }
  | { command: "chat-response"; response: OceanumResponse }
  | { command: "chat-error"; message: string };
