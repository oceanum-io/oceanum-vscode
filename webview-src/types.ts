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

export type OceanumResponse =
  | { type: "text"; message: string }
  | { type: "code"; message: string; code: string }
  | { type: "markdown"; content: string; message?: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ExtToWebviewMessage =
  | { command: "workspace-update"; spec: IWorkspaceSpec }
  | { command: "token-status"; hasToken: boolean }
  | { command: "notebook-context"; cells: string[] }
  | { command: "chat-response"; response: OceanumResponse }
  | { command: "chat-error"; message: string };
