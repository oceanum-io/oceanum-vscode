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
  insertNotebookCell,
  getNotebookCells,
  notebookCellsOf,
  selectedCellIn,
  runCellAndHarvest,
} from "../notebook/notebookUtils";
import { runChatLoop, type PlacedResponse } from "../ai/loop";

/** A notebook's file name, for the panel to show. */
function notebookName(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/** Where `uri` is after `oldUri` was renamed to `newUri`, if that moved it. */
function movedTo(
  uri: vscode.Uri,
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
): vscode.Uri | undefined {
  const at = uri.toString();
  const from = oldUri.toString();
  if (at === from) {
    return newUri;
  }
  // A folder that contains it was renamed.
  return at.startsWith(`${from}/`)
    ? vscode.Uri.parse(newUri.toString() + at.slice(from.length))
    : undefined;
}

// The smallest valid notebook. Naming Python lets the editor offer Python
// kernels straight away.
const EMPTY_NOTEBOOK = `${JSON.stringify(
  {
    cells: [],
    metadata: { language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  1,
)}\n`;

/**
 * Where a new notebook goes: beside the file in the active tab when that is
 * in the workspace, else the first workspace folder, else nowhere (no folder
 * is open).
 */
function folderForNewNotebook(): vscode.Uri | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (
    active?.scheme === "file" &&
    vscode.workspace.getWorkspaceFolder(active)
  ) {
    return vscode.Uri.joinPath(active, "..");
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** An empty notebook file under `folder`, named like Jupyter's. */
async function writeNewNotebook(folder: vscode.Uri): Promise<vscode.Uri> {
  for (let n = 1; ; n += 1) {
    const uri = vscode.Uri.joinPath(
      folder,
      n === 1 ? "Untitled.ipynb" : `Untitled${n}.ipynb`,
    );
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(EMPTY_NOTEBOOK),
      );
      return uri;
    }
  }
}

/**
 * A new notebook, shown as the active tab with focus left in the chat.
 *
 * Written as a FILE wherever there is somewhere to put it. An untitled buffer
 * gets a new URI when it is saved and the untitled document is closed, so a
 * conversation pinned to it would lose its notebook at the first save. Only
 * with no folder open is the notebook untitled.
 */
async function createNotebook(): Promise<vscode.NotebookDocument> {
  const folder = folderForNewNotebook();
  const notebook = folder
    ? await vscode.workspace.openNotebookDocument(
        await writeNewNotebook(folder),
      )
    : await vscode.workspace.openNotebookDocument(
        "jupyter-notebook",
        new vscode.NotebookData([]),
      );
  await vscode.window.showNotebookDocument(notebook, { preserveFocus: true });
  return notebook;
}

/** The notebook a request's answers are placed in, updated as it moves. */
interface Target {
  uri: vscode.Uri;
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
  // The notebook the current conversation lives in -- what the agent is
  // shown, and where its answers go -- or undefined until it starts. Held by
  // URI, so it survives being closed and opened again, and follows renames.
  private _pinned: vscode.Uri | undefined;
  // Where the current run places its answers; follows renames with the pin.
  private _target: Target | undefined;
  // Starting a conversation can create a notebook, so starts run one at a
  // time: a second New chat must find the notebook the first one created as
  // the active tab rather than create another.
  private _starting: Promise<void> = Promise.resolve();

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

    // The pinned notebook, or a folder holding it, renamed or moved: the
    // conversation goes with it rather than losing it and making another.
    vscode.workspace.onDidRenameFiles(
      (event) => {
        for (const { oldUri, newUri } of event.files) {
          const pinned = this._pinned && movedTo(this._pinned, oldUri, newUri);
          if (pinned) {
            this._pinned = pinned;
            this._post({
              command: "chat-context",
              notebook: notebookName(pinned),
            });
          }
          const target =
            this._target && movedTo(this._target.uri, oldUri, newUri);
          if (target && this._target) {
            this._target.uri = target;
          }
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

  /**
   * Start a conversation, pinned to the notebook in the active tab -- or,
   * when that tab is not a notebook, to a new one made the active tab.
   */
  private _start(): Promise<void> {
    const run = this._starting.then(async () => {
      this._pinned = undefined;
      this._pin(
        vscode.window.activeNotebookEditor?.notebook ??
          (await createNotebook()),
      );
    });
    this._starting = run.catch(() => undefined);
    return run;
  }

  private _pin(notebook: vscode.NotebookDocument): void {
    this._pinned = notebook.uri;
    this._post({
      command: "chat-context",
      notebook: notebookName(notebook.uri),
    });
  }

  /**
   * The notebook at `uri`, read from its file if it has been closed -- which
   * loads it without showing a tab. Undefined for an untitled notebook that
   * has been closed, or one whose file has gone.
   */
  private async _find(
    uri: vscode.Uri,
  ): Promise<vscode.NotebookDocument | undefined> {
    const open = vscode.workspace.notebookDocuments.find(
      (n) => !n.isClosed && n.uri.toString() === uri.toString(),
    );
    if (open || uri.scheme === "untitled") {
      return open;
    }
    return Promise.resolve(vscode.workspace.openNotebookDocument(uri)).then(
      (n) => n,
      () => undefined,
    );
  }

  /**
   * The notebook at `uri`, for placing an answer in. When it cannot be found
   * (see _find), a new notebook takes its place -- and becomes the
   * conversation's, if `uri` still is.
   */
  private async _open(uri: vscode.Uri): Promise<vscode.NotebookDocument> {
    const found = await this._find(uri);
    if (found) {
      return found;
    }
    const replacement = await createNotebook();
    if (this._pinned?.toString() === uri.toString()) {
      this._pin(replacement);
    }
    return replacement;
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
        // A notebook that cannot be created is not reported here: the panel
        // ignores run messages until the next request, which tries again and
        // says why.
        await this._start().catch(() =>
          this._post({ command: "chat-context", notebook: null }),
        );
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
    let target: Target | undefined;

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
      await this._starting;
      if (this._pinned === undefined) {
        await this._start();
      }
      if (this._current !== controller || this._pinned === undefined) {
        return;
      }
      // This request's notebook, captured now: if New chat pins another one
      // while it runs, its answers must not follow the new pin. Only read
      // here: a notebook that has gone is replaced when an answer has cells
      // to place in it, not for asking a question.
      const pinned = this._pinned;
      const notebook = await this._find(pinned);
      if (this._current !== controller) {
        return;
      }
      target = { uri: notebook?.uri ?? pinned };
      this._target = target;
      const cells = notebook ? notebookCellsOf(notebook) : [];
      const selected = notebook ? selectedCellIn(notebook) : null;

      const payload: Record<string, unknown> = { prompt };
      if (chatHistory.length > 0) {
        payload.chatHistory = chatHistory;
      }
      if (cells.length > 0) {
        payload.notebookCells = cells;
      }
      if (selected) {
        payload[selected.isCode ? "codeContext" : "context"] = selected.source;
      }

      // Read per prompt, not once at activation, so a settings change applies
      // to the next question without a reload.
      const cfg = vscode.workspace.getConfiguration("oceanum");
      const autoRunCode = cfg.get<boolean>("autoRunCode", false);
      const iterate = cfg.get<boolean>("iterate", false);

      const placeInto = target;
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
            this._place(placeInto, response, autoRun, signal),
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
      if (target && this._target === target) {
        this._target = undefined;
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
   * cells -- into the conversation's notebook, and, when auto-run is on, run
   * each code cell as it lands and report what it produced. Stop ends
   * placement between blocks and cancels the cell that is running.
   */
  private async _place(
    target: Target,
    response: OceanumResponse,
    autoRun: boolean,
    signal: AbortSignal,
  ): Promise<PlacedResponse> {
    const runs: PlacedResponse["runs"] = [];
    if (response.blocks.length === 0 || signal.aborted) {
      return { runs };
    }
    // Every answer goes into the conversation's notebook, whichever tab is in
    // front: that notebook is brought to the front -- opened again if it was
    // closed -- so the user sees where it went. A replacement becomes where
    // the rest of this run goes too, or every later round would make another.
    const notebook = await this._open(target.uri);
    target.uri = notebook.uri;
    if (signal.aborted) {
      return { runs };
    }
    // Below the selected cell when the user is working in this notebook --
    // they chose the spot. Otherwise at the end: a selection in a notebook
    // they are not looking at, or the first cell of one just reopened, is
    // nobody's choice.
    const userIsHere =
      vscode.window.activeNotebookEditor?.notebook === notebook;
    // Focus stays where it was, so a follow-up can be typed while cells land.
    const editor = await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: true,
    });
    if (!userIsHere) {
      editor.selection = new vscode.NotebookRange(
        notebook.cellCount,
        notebook.cellCount,
      );
    }
    for (const block of response.blocks) {
      if (signal.aborted) {
        break;
      }
      // Through the editor shown above, not whichever is active: the user may
      // click another tab while the answer is still landing.
      const cell = await insertNotebookCell(editor, block.content, block.type);
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
