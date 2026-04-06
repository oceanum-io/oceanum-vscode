// Copyright Oceanum Ltd. Apache 2.0
// acquireVsCodeApi() must be called exactly once per webview lifetime.

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const _api = acquireVsCodeApi();
export const vscode = _api;
