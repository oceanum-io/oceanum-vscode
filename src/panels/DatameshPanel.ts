// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { DATAMESH_UI_URL } from "../constants";
import { getNonce } from "../utils/nonce";
import type { IWorkspaceSpec } from "../types";

export type WorkspaceModifyHandler = (spec: IWorkspaceSpec) => void;

export class DatameshPanel {
  private static _instance: DatameshPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _onWorkspaceModify: WorkspaceModifyHandler;

  private constructor(
    context: vscode.ExtensionContext,
    onWorkspaceModify: WorkspaceModifyHandler,
  ) {
    this._onWorkspaceModify = onWorkspaceModify;

    this._panel = vscode.window.createWebviewPanel(
      "oceanum.datameshUI",
      "Oceanum Datamesh",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this._panel.iconPath = {
      light: vscode.Uri.joinPath(
        context.extensionUri,
        "images",
        "oceanum-icon-light.svg",
      ),
      dark: vscode.Uri.joinPath(
        context.extensionUri,
        "images",
        "oceanum-icon-dark.svg",
      ),
    };

    this._panel.webview.html = this._buildHtml();

    this._panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.action === "workspace-modify") {
          this._onWorkspaceModify({
            id: msg.id ?? "",
            name: msg.name ?? "Workspace",
            data: msg.data ?? [],
          });
        }
      },
      null,
      this._disposables,
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  static get instance(): DatameshPanel | undefined {
    return DatameshPanel._instance;
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    onWorkspaceModify: WorkspaceModifyHandler,
  ): DatameshPanel {
    if (DatameshPanel._instance) {
      // Update the callback so the caller always gets fresh routing
      DatameshPanel._instance._onWorkspaceModify = onWorkspaceModify;
      DatameshPanel._instance._panel.reveal();
      return DatameshPanel._instance;
    }
    DatameshPanel._instance = new DatameshPanel(context, onWorkspaceModify);
    return DatameshPanel._instance;
  }

  updateToken(token: string): void {
    void this._panel.webview.postMessage({
      source: "oceanum-app",
      datameshToken: token,
    });
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             frame-src ${DATAMESH_UI_URL};
             script-src 'nonce-${nonce}';
             style-src 'unsafe-inline';">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe id="datamesh-frame" src="${DATAMESH_UI_URL}" allow="*"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('datamesh-frame');

    frame.addEventListener('load', function() {
      frame.contentWindow.postMessage({ source: 'oceanum-app' }, '${DATAMESH_UI_URL}');
    });

    // Single handler: relay workspace-modify from iframe, forward token updates to iframe
    window.addEventListener('message', function(event) {
      if (!event.data) return;
      if (event.data.action === 'workspace-modify') {
        vscode.postMessage(event.data);
      } else if (event.source !== frame.contentWindow && event.data.datameshToken !== undefined) {
        // Message from extension host (not the iframe) — forward token to iframe
        frame.contentWindow.postMessage(
          { source: 'oceanum-app', datameshToken: event.data.datameshToken },
          '${DATAMESH_UI_URL}'
        );
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    DatameshPanel._instance = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
