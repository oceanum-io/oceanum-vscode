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

export type OceanumResponse =
  | { type: "text"; message: string }
  | { type: "code"; message: string; code: string }
  | { type: "markdown"; content: string; message?: string };

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
