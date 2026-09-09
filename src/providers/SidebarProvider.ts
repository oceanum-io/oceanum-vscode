// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { OCEANUM_AI_BACKEND_URL } from "../constants";
import { COMMANDS } from "../commands";
import { getNonce } from "../utils/nonce";
import type {
  WebviewToExtMessage,
  ExtToWebviewMessage,
  IWorkspaceSpec,
  ChatMessage,
  OceanumResponse,
} from "../types";
import {
  generateDatasourceCode,
  generateTokenLine,
} from "../codegen/datasourceCodegen";
import {
  insertContent,
  getNotebookCells,
  getActiveCellSource,
  runCellAndHarvest,
} from "../notebook/notebookUtils";
import { runChatLoop } from "../ai/loop";
import type { ObservedRun } from "../types";

// Mirrors the server's EXECUTE_MAX_ROUNDS. Past it the server strips any
// code from its answer, so there would be nothing to run anyway.
const MAX_ROUNDS = 5;

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _disposables: vscode.Disposable[] = [];
  // Queued until the webview view is first resolved
  private _pendingWorkspaceSpec: IWorkspaceSpec | undefined;
  // Cached token — invalidated via invalidateToken() on any token change
  private _cachedToken: string | undefined;
  // The chat run in flight, if any; "chat-stop" aborts it.
  private _current: AbortController | undefined;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => void this._handleMessage(msg),
      null,
      this._disposables,
    );

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];
    });

    // Flush any workspace update that arrived before the view was ready
    if (this._pendingWorkspaceSpec) {
      this._post({
        command: "workspace-update",
        spec: this._pendingWorkspaceSpec,
      });
      this._pendingWorkspaceSpec = undefined;
    }
  }

  sendWorkspaceUpdate(spec: IWorkspaceSpec): void {
    if (!this._view) {
      // View not yet resolved — keep the latest spec so it's sent on open
      this._pendingWorkspaceSpec = spec;
      return;
    }
    this._post({ command: "workspace-update", spec });
  }

  sendTokenStatus(hasToken: boolean): void {
    this._post({ command: "token-status", hasToken });
  }

  /** Called by extension.ts whenever the token is written or cleared. */
  invalidateToken(): void {
    this._cachedToken = undefined;
  }

  private _post(msg: ExtToWebviewMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private async _handleMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.command) {
      case "open-datamesh":
        await vscode.commands.executeCommand(COMMANDS.OPEN_DATAMESH);
        break;

      case "set-token":
        await vscode.commands.executeCommand(COMMANDS.SET_TOKEN);
        break;

      case "get-token-status": {
        const token = await this._getToken();
        this._post({ command: "token-status", hasToken: !!token });
        break;
      }

      case "get-notebook-context":
        this._post({ command: "notebook-context", cells: getNotebookCells() });
        break;

      case "insert-datasource": {
        const injectToken = vscode.workspace
          .getConfiguration("oceanum")
          .get<boolean>("injectToken", false);
        const lines: string[] = [];
        if (injectToken) lines.push(generateTokenLine());
        lines.push(generateDatasourceCode(msg.datasource, injectToken));
        await insertContent(lines.join("\n"), "code");
        break;
      }

      case "chat-request":
        await this._handleChatRequest(msg.prompt, msg.chatHistory);
        break;

      case "chat-stop":
        this._current?.abort();
        break;
    }
  }

  private async _handleChatRequest(
    prompt: string,
    chatHistory: ChatMessage[],
  ): Promise<void> {
    const token = await this._getToken();
    if (!token) {
      this._post({
        command: "chat-error",
        message: "Datamesh token not configured.",
      });
      return;
    }

    const cells = getNotebookCells();
    const activeCell = getActiveCellSource();

    const payload: Record<string, unknown> = { prompt };
    if (chatHistory.length > 0) payload.chatHistory = chatHistory;
    if (cells.length > 0) payload.notebookCells = cells;
    if (activeCell) {
      payload[activeCell.isCode ? "codeContext" : "context"] =
        activeCell.source;
    }

    // Read per prompt, not once at activation, so a settings change applies
    // to the next question without a reload.
    const cfg = vscode.workspace.getConfiguration("oceanum");
    const autoRunCode = cfg.get<boolean>("autoRunCode", false);
    const iterate = cfg.get<boolean>("iterate", false);

    this._current?.abort();
    const controller = new AbortController();
    this._current = controller;

    try {
      const outcome = await runChatLoop(
        prompt,
        chatHistory,
        {
          route: (p, h, signal) =>
            this._call(
              "/api/chat",
              { ...payload, prompt: p, chatHistory: h },
              token,
              signal,
            ),
          observe: (p, h, runs, signal) =>
            this._call(
              "/api/chat/observe",
              { ...payload, prompt: p, chatHistory: h, runs },
              token,
              signal,
            ),
          place: (response, autoRun) => this._place(response, autoRun),
          // One bubble per round, as it happens, so a chain of three steps
          // reads as three steps while it is still running.
          say: (response) => this._post({ command: "chat-response", response }),
        },
        {
          autoRunCode,
          iterate,
          maxRounds: MAX_ROUNDS,
          signal: controller.signal,
        },
      );
      if (outcome === "stopped") {
        this._post({ command: "chat-stopped" });
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        this._post({ command: "chat-stopped" });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this._post({ command: "chat-error", message });
    } finally {
      if (this._current === controller) {
        this._current = undefined;
      }
    }
  }

  /** One POST to the backend, with the token and the run's abort signal. */
  private async _call(
    path: string,
    body: Record<string, unknown>,
    token: string,
    signal: AbortSignal,
  ): Promise<OceanumResponse> {
    let res: Response;
    try {
      res = await fetch(`${OCEANUM_AI_BACKEND_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Datamesh-Token": token,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      if (signal.aborted) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not reach Oceanum AI: ${message}`);
    }
    if (res.status === 401) {
      throw new Error("Invalid or expired Datamesh token.");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Backend error: ${text}`);
    }
    const data = (await res.json()) as Partial<OceanumResponse> | null;
    // Checked rather than cast. The cast was safe only while the contract
    // never changed; it has (OCE-173), and an extension meeting a backend on
    // the other side of that change would read `blocks` off a body with none.
    if (
      !data ||
      typeof data.message !== "string" ||
      !Array.isArray(data.blocks)
    ) {
      throw new Error(
        "Unexpected response from Oceanum AI. It may be running an " +
          "incompatible version of the chat API.",
      );
    }
    return { message: data.message, blocks: data.blocks };
  }

  /**
   * Place every block in order -- code as code cells, markdown as markdown
   * cells -- and, when auto-run is on, run each code cell as it lands and
   * report what it produced.
   */
  private async _place(
    response: OceanumResponse,
    autoRun: boolean,
  ): Promise<{ runs: ObservedRun[] }> {
    const runs: ObservedRun[] = [];
    for (const block of response.blocks) {
      const index = await insertContent(block.content, block.type);
      if (block.type === "code" && autoRun && index !== null) {
        const outcome = await runCellAndHarvest(index);
        runs.push({ code: block.content, message: "", ...outcome });
      }
    }
    return { runs };
  }

  private async _getToken(): Promise<string> {
    if (this._cachedToken !== undefined) return this._cachedToken;
    const secret = await this._context.secrets.get("oceanum.datameshToken");
    const token =
      secret ??
      vscode.workspace
        .getConfiguration("oceanum")
        .get<string>("datameshToken", "");
    this._cachedToken = token;
    return token;
  }

  private _buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "out", "sidebar.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "out", "sidebar.css"),
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}';
             style-src 'unsafe-inline' ${webview.cspSource};
             font-src ${webview.cspSource} https://fonts.gstatic.com;
             img-src ${webview.cspSource} https:;
             connect-src ${OCEANUM_AI_BACKEND_URL};">
  <title>Oceanum</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>
    html, body, #root { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
