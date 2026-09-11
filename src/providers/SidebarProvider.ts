// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { MAX_OBSERVE_ROUNDS, OCEANUM_AI_BACKEND_URL } from "../constants";
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
  notebookCellsOf,
  activeCellSourceIn,
  runCellAndHarvest,
} from "../notebook/notebookUtils";
import { runChatLoop, type PlacedResponse } from "../ai/loop";

/** A notebook's file name, for the panel to show. */
function notebookName(notebook: vscode.NotebookDocument): string {
  const path = notebook.uri.path;
  return path.slice(path.lastIndexOf("/") + 1);
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _disposables: vscode.Disposable[] = [];
  // Queued until the webview view is first resolved
  private _pendingWorkspaceSpec: IWorkspaceSpec | undefined;
  // Cached token — invalidated via invalidateToken() on any token change
  private _cachedToken: string | undefined;
  // The chat run in flight, if any; "chat-stop" aborts it.
  private _current: AbortController | undefined;
  // The notebook the current conversation is about: undefined until the
  // conversation starts, null when it has none. Pinned when it starts -- New
  // chat, or the first message -- from the ACTIVE TAB, and kept for the whole
  // conversation, so switching tabs mid-thread does not change what the agent
  // is shown.
  private _pinned: vscode.NotebookDocument | null | undefined;

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

    // A pinned notebook that closes is dropped at once rather than at the next
    // message, so the panel stops showing it as the context straight away.
    vscode.workspace.onDidCloseNotebookDocument(
      (closed) => {
        if (closed === this._pinned) {
          this._pinned = null;
          this._post({ command: "chat-context", notebook: null });
        }
      },
      null,
      this._disposables,
    );

    webviewView.onDidDispose(() => {
      // The Stop button went with the view; a run left going would keep
      // executing cells in the kernel with nothing able to halt it.
      this._current?.abort();
      // The conversation went with it too: a new view starts a new one.
      this._pinned = undefined;
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

  /** Pin the notebook in the active tab, if any, as the conversation's. */
  private _pin(): void {
    this._pinned = vscode.window.activeNotebookEditor?.notebook ?? null;
    this._post({
      command: "chat-context",
      notebook: this._pinned ? notebookName(this._pinned) : null,
    });
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
        if (injectToken) {
          lines.push(generateTokenLine());
        }
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

      case "chat-new": {
        // End the run in flight WITHOUT a "Stopped." -- that belongs to the
        // conversation being thrown away. Clearing `_current` is what
        // silences it: the loop stops at the abort before showing another
        // round, and everything the run posts after that first checks that it
        // is still the current run.
        const run = this._current;
        this._current = undefined;
        run?.abort();
        this._pin();
        break;
      }
    }
  }

  private async _handleChatRequest(
    prompt: string,
    chatHistory: ChatMessage[],
  ): Promise<void> {
    // Become the current run BEFORE the first await. New chat can land while
    // the token is still being read, and it can only end a run it can see:
    // registered after the read, the request ran to completion regardless and
    // placed its cells in the notebook.
    this._current?.abort();
    const controller = new AbortController();
    this._current = controller;

    try {
      const token = await this._getToken();
      // Replaced -- by New chat, or a newer request -- while reading it.
      if (this._current !== controller) {
        return;
      }
      if (!token) {
        this._post({
          command: "chat-error",
          message: "Datamesh token not configured.",
        });
        return;
      }

      // A conversation nobody started with New chat starts at its first
      // message, the same way.
      if (this._pinned === undefined) {
        this._pin();
      } else if (this._pinned?.isClosed) {
        // Closed since it was pinned: say so, rather than keep claiming it.
        this._pinned = null;
        this._post({ command: "chat-context", notebook: null });
      }
      const notebook = this._pinned;
      const cells = notebook ? notebookCellsOf(notebook) : [];
      const activeCell = notebook ? activeCellSourceIn(notebook) : null;

      const payload: Record<string, unknown> = { prompt };
      if (chatHistory.length > 0) {
        payload.chatHistory = chatHistory;
      }
      if (cells.length > 0) {
        payload.notebookCells = cells;
      }
      if (activeCell) {
        payload[activeCell.isCode ? "codeContext" : "context"] =
          activeCell.source;
      }

      // Read per prompt, not once at activation, so a settings change applies
      // to the next question without a reload.
      const cfg = vscode.workspace.getConfiguration("oceanum");
      const autoRunCode = cfg.get<boolean>("autoRunCode", false);
      const iterate = cfg.get<boolean>("iterate", false);

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
          place: (response, autoRun, signal) =>
            this._place(response, autoRun, signal),
          // One bubble per round, as it happens, so a chain of three steps
          // reads as three steps while it is still running.
          say: (response) => this._post({ command: "chat-response", response }),
        },
        {
          autoRunCode,
          iterate,
          maxRounds: MAX_OBSERVE_ROUNDS,
          signal: controller.signal,
        },
      );
      // A newer request has taken over the panel: its state is the one the
      // webview shows, so this run's ending must not flip it back.
      if (this._current !== controller) {
        return;
      }
      this._post({
        command: outcome === "stopped" ? "chat-stopped" : "chat-done",
      });
    } catch (err: unknown) {
      if (this._current !== controller) {
        return;
      }
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
   * report what it produced. Stop ends placement between blocks and cancels
   * the cell that is running.
   */
  private async _place(
    response: OceanumResponse,
    autoRun: boolean,
    signal: AbortSignal,
  ): Promise<PlacedResponse> {
    const runs: PlacedResponse["runs"] = [];
    for (const block of response.blocks) {
      if (signal.aborted) {
        break;
      }
      const cell = await insertContent(block.content, block.type);
      if (block.type === "code" && autoRun && cell !== null) {
        const outcome = await runCellAndHarvest(cell, signal);
        runs.push({ code: block.content, ...outcome });
      }
    }
    return { runs };
  }

  private async _getToken(): Promise<string> {
    if (this._cachedToken !== undefined) {
      return this._cachedToken;
    }
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
