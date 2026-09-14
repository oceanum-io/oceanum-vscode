// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface FakeUri {
  scheme: string;
  path: string;
  toString(): string;
}

interface FakeCell {
  kind: number;
  readonly index: number;
  notebook: FakeNotebook;
  document: { getText(): string };
  outputs: Array<{ items: unknown[] }>;
  executionSummary: { success?: boolean } | undefined;
}

interface FakeEditor {
  notebook: FakeNotebook;
  selection: { isEmpty: boolean; start: number; end: number };
  revealRange(): void;
}

interface CellEdit {
  index: number;
  cells: Array<{ kind: number; value: string }>;
}

const state = vi.hoisted(() => {
  const uri = (scheme: string, path: string): FakeUri => ({
    scheme,
    path,
    toString: () => `${scheme}:${path}`,
  });
  return {
    uri,
    activeNotebookEditor: undefined as FakeEditor | undefined,
    activeTextEditor: undefined as { document: { uri: FakeUri } } | undefined,
    workspaceFolders: undefined as Array<{ uri: FakeUri }> | undefined,
    config: {} as Record<string, unknown>,
    documents: [] as FakeNotebook[],
    onDisk: new Map<string, FakeNotebook>(),
    created: 0,
    written: [] as string[],
    // What `fs.stat` fails with, when the failure is not "no such file".
    statError: undefined as unknown,
    shown: [] as Array<{ path: string; preserveFocus?: boolean }>,
    inserted: [] as Array<{ path: string; index: number; text: string }>,
    afterInsert: undefined as (() => void) | undefined,
    // A cell text the notebook refuses to take, as a read-only one does.
    refuse: undefined as ((text: string) => boolean) | undefined,
    // What opening or creating a notebook fails with, and running a cell.
    openError: undefined as unknown,
    runError: undefined as unknown,
    // Called as a cell starts running, before `runError` is thrown.
    duringRun: undefined as (() => void) | undefined,
    renameListeners: [] as Array<
      (event: { files: Array<{ oldUri: FakeUri; newUri: FakeUri }> }) => void
    >,
    openListeners: [] as Array<(notebook: FakeNotebook) => void>,
    closeListeners: [] as Array<(notebook: FakeNotebook) => void>,
    fake: undefined as
      | {
          notebook(path: string, scheme?: string): FakeNotebook;
          editor(notebook: FakeNotebook): FakeEditor;
        }
      | undefined,
  };
});

vi.mock("vscode", () => {
  class NotebookRange {
    isEmpty: boolean;
    constructor(
      public start: number,
      public end: number,
    ) {
      this.isEmpty = start === end;
    }
  }
  class FileSystemError extends Error {
    // As in VS Code: the constructor takes a message, and only the static
    // makers set a code. Anything else built by hand is "Unknown".
    code = "Unknown";
    static FileNotFound(): FileSystemError {
      return FileSystemError.withCode("FileNotFound");
    }
    static NoPermissions(): FileSystemError {
      return FileSystemError.withCode("NoPermissions");
    }
    static withCode(code: string): FileSystemError {
      const error = new FileSystemError(code);
      error.code = code;
      return error;
    }
  }
  class WorkspaceEdit {
    entries: Array<{ uri: FakeUri; edits: CellEdit[] }> = [];
    set(uri: FakeUri, edits: CellEdit[]) {
      this.entries.push({ uri, edits });
    }
  }
  const find = (uri: FakeUri) =>
    state.documents.find((d) => d.uri.toString() === uri.toString());
  return {
    window: {
      get activeNotebookEditor() {
        return state.activeNotebookEditor;
      },
      get visibleNotebookEditors() {
        return state.activeNotebookEditor ? [state.activeNotebookEditor] : [];
      },
      get activeTextEditor() {
        return state.activeTextEditor;
      },
      showNotebookDocument: vi.fn(
        async (
          notebook: FakeNotebook,
          options?: { preserveFocus?: boolean },
        ) => {
          state.shown.push({
            path: notebook.uri.path,
            preserveFocus: options?.preserveFocus,
          });
          // Shown in the active editor group, so it becomes the active
          // notebook editor whether or not it took the keyboard focus.
          const shown = state.fake!.editor(notebook);
          state.activeNotebookEditor = shown;
          return shown;
        },
      ),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key in state.config ? state.config[key] : fallback,
      }),
      get workspaceFolders() {
        return state.workspaceFolders;
      },
      getWorkspaceFolder: (uri: FakeUri) =>
        state.workspaceFolders?.find((f) =>
          uri.path.startsWith(`${f.uri.path}/`),
        ),
      get notebookDocuments() {
        return state.documents;
      },
      fs: {
        stat: vi.fn(async (uri: FakeUri) => {
          if (state.statError) {
            throw state.statError;
          }
          if (!state.onDisk.has(uri.path)) {
            throw FileSystemError.FileNotFound();
          }
          return {};
        }),
        writeFile: vi.fn(async (uri: FakeUri) => {
          state.written.push(uri.path);
          const written = state.fake!.notebook(uri.path);
          written.isClosed = true;
          state.onDisk.set(uri.path, written);
        }),
      },
      openNotebookDocument: vi.fn(async (what: unknown) => {
        if (state.openError) {
          throw state.openError;
        }
        if (typeof what === "string") {
          state.created += 1;
          const fresh = state.fake!.notebook(
            `Untitled-${state.created}.ipynb`,
            "untitled",
          );
          state.documents.push(fresh);
          state.openListeners.forEach((listener) => listener(fresh));
          return fresh;
        }
        const found = state.onDisk.get((what as FakeUri).path);
        if (!found) {
          throw new Error("no such file");
        }
        found.isClosed = false;
        if (!state.documents.includes(found)) {
          state.documents.push(found);
          state.openListeners.forEach((listener) => listener(found));
        }
        return found;
      }),
      applyEdit: vi.fn(
        async (edit: {
          entries: Array<{ uri: FakeUri; edits: CellEdit[] }>;
        }) => {
          const refused = edit.entries.some(({ edits }) =>
            edits.some(({ cells }) =>
              cells.some((cell) => state.refuse?.(cell.value)),
            ),
          );
          if (refused) {
            return false;
          }
          for (const { uri, edits } of edit.entries) {
            for (const { index, cells } of edits) {
              for (const cell of cells) {
                state.inserted.push({
                  path: uri.path,
                  index,
                  text: cell.value,
                });
                find(uri)?.insert(index, cell.kind, cell.value);
              }
            }
          }
          state.afterInsert?.();
          return true;
        },
      ),
      onDidRenameFiles: (listener: (typeof state.renameListeners)[number]) => {
        state.renameListeners.push(listener);
        return { dispose() {} };
      },
      onDidOpenNotebookDocument: (listener: (nb: FakeNotebook) => void) => {
        state.openListeners.push(listener);
        return { dispose() {} };
      },
      onDidCloseNotebookDocument: (listener: (nb: FakeNotebook) => void) => {
        state.closeListeners.push(listener);
        return { dispose() {} };
      },
    },
    commands: {
      executeCommand: vi.fn(
        async (
          command: string,
          args?: { ranges: Array<{ start: number }>; document: FakeUri },
        ) => {
          if (command === "notebook.cell.execute") {
            state.duringRun?.();
          }
          if (command === "notebook.cell.execute" && state.runError) {
            throw state.runError;
          }
          if (command === "notebook.cell.execute" && args) {
            const cell = find(args.document)?.cellAt(args.ranges[0].start);
            if (cell) {
              cell.executionSummary = { success: true };
            }
          }
        },
      ),
    },
    env: { clipboard: { writeText: vi.fn() } },
    Uri: {
      joinPath: (base: FakeUri, ...parts: string[]) => {
        const segments = (base.path ?? "").split("/");
        for (const part of parts) {
          if (part === "..") {
            segments.pop();
          } else {
            segments.push(part);
          }
        }
        return state.uri(base.scheme ?? "file", segments.join("/"));
      },
      parse: (text: string) => {
        const colon = text.indexOf(":");
        return state.uri(text.slice(0, colon), text.slice(colon + 1));
      },
    },
    NotebookCellKind: { Markup: 1, Code: 2 },
    NotebookData: class {
      constructor(public cells: unknown[]) {}
    },
    NotebookCellData: class {
      constructor(
        public kind: number,
        public value: string,
        public languageId: string,
      ) {}
    },
    NotebookEdit: {
      insertCells: (index: number, cells: unknown[]) => ({ index, cells }),
    },
    NotebookRange,
    WorkspaceEdit,
    FileSystemError,
  };
});

import { SidebarProvider } from "../providers/SidebarProvider";
import { FileSystemError } from "vscode";

const CODE = 2;
const MARKUP = 1;

class FakeNotebook {
  isClosed = false;
  readonly cells: FakeCell[] = [];

  constructor(
    public uri: FakeUri,
    cells: Array<[number, string]> = [],
  ) {
    for (const [kind, text] of cells) {
      this.insert(this.cells.length, kind, text);
    }
  }

  get cellCount(): number {
    return this.cells.length;
  }

  getCells(): FakeCell[] {
    return this.cells;
  }

  cellAt(index: number): FakeCell {
    return this.cells[index];
  }

  insert(index: number, kind: number, text: string): void {
    const cells = this.cells;
    const cell: FakeCell = {
      kind,
      notebook: this,
      document: { getText: () => text },
      outputs: [],
      executionSummary: undefined,
      get index() {
        return cells.indexOf(cell);
      },
    };
    cells.splice(index, 0, cell);
  }
}

/** A notebook at `/work/<name>`, or at `name` when it is untitled. */
function notebook(
  name: string,
  cells: Array<[number, string]> = [],
  scheme = "file",
): FakeNotebook {
  const path =
    scheme === "file" && !name.startsWith("/") ? `/work/${name}` : name;
  return new FakeNotebook(state.uri(scheme, path), cells);
}

const editors = new Map<FakeNotebook, FakeEditor>();

/** The editor showing `nb`, with cell `selected` selected (or nothing). */
function editor(nb: FakeNotebook, selected?: number): FakeEditor {
  const made: FakeEditor = {
    notebook: nb,
    selection:
      selected === undefined
        ? { isEmpty: true, start: 0, end: 0 }
        : { isEmpty: false, start: selected, end: selected + 1 },
    revealRange: () => {},
  };
  editors.set(nb, made);
  return made;
}

/** Open `nb` in the active tab; a file notebook is on disk too. */
function activate(nb: FakeNotebook, selected?: number): void {
  if (!state.documents.includes(nb)) {
    state.documents.push(nb);
    state.openListeners.forEach((listener) => listener(nb));
  }
  if (nb.uri.scheme === "file") {
    state.onDisk.set(nb.uri.path, nb);
  }
  state.activeNotebookEditor = editor(nb, selected);
}

/** Close `nb`'s tab. An untitled notebook is gone; a file one stays on disk. */
function close(nb: FakeNotebook): void {
  nb.isClosed = true;
  editors.delete(nb);
  state.documents = state.documents.filter((d) => d !== nb);
  if (state.activeNotebookEditor?.notebook === nb) {
    state.activeNotebookEditor = undefined;
  }
  state.closeListeners.forEach((listener) => listener(nb));
}

/** Rename or move the file or folder at `from` to `to`, as the explorer does. */
function move(from: string, to: string): void {
  const all = new Set([...state.documents, ...state.onDisk.values()]);
  for (const nb of all) {
    const path = nb.uri.path;
    if (path === from || path.startsWith(`${from}/`)) {
      nb.uri = state.uri("file", to + path.slice(from.length));
    }
  }
  state.onDisk = new Map(
    [...state.onDisk.values()].map((nb) => [nb.uri.path, nb]),
  );
  const event = {
    files: [{ oldUri: state.uri("file", from), newUri: state.uri("file", to) }],
  };
  for (const listener of state.renameListeners) {
    listener(event);
  }
}

/**
 * Save the untitled `nb` as a file, in the order VS Code 1.135 does it
 * (`doSaveAs`). The file notebook opens in its tab, empty, and is filled.
 * It is then saved, and a save participant (format on save, trimming
 * whitespace) may `rewrite` each cell's text. Only then does the untitled
 * notebook close. No rename event says any of it.
 */
function saveAs(
  nb: FakeNotebook,
  path: string,
  rewrite: (text: string) => string = (text) => text,
): FakeNotebook {
  const saved = new FakeNotebook(state.uri("file", path));
  activate(saved);
  nb.cells.forEach((cell, index) => {
    saved.insert(index, cell.kind, rewrite(cell.document.getText()));
  });
  close(nb);
  return saved;
}

type Posted = { command: string; [key: string]: unknown };

function openPanel() {
  const posted: Posted[] = [];
  let receive: (msg: unknown) => void = () => {};
  let visible = true;
  let visibilityChanged: () => void = () => {};
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "",
      asWebviewUri: (uri: unknown) => uri,
      // A hidden view receives nothing, as in VS Code.
      postMessage: (msg: Posted) => {
        if (!visible) {
          return Promise.resolve(false);
        }
        posted.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: (msg: unknown) => void) => {
        receive = listener;
        return { dispose() {} };
      },
    },
    onDidDispose: () => ({ dispose() {} }),
    get visible() {
      return visible;
    },
    onDidChangeVisibility: (listener: () => void) => {
      visibilityChanged = listener;
      return { dispose() {} };
    },
  };
  const provider = new SidebarProvider({
    extensionUri: state.uri("file", "/extension"),
    secrets: { get: async () => "a-token" },
  } as never);
  provider.resolveWebviewView(view as never, {} as never, {} as never);
  return {
    posted,
    send: (msg: unknown) => receive(msg),
    setVisible: (shown: boolean) => {
      visible = shown;
      visibilityChanged();
    },
  };
}

const contexts = (posted: Posted[]) =>
  posted.filter((m) => m.command === "chat-context").map((m) => m.notebook);

const requests: Array<{
  body: Record<string, unknown>;
  signal: AbortSignal;
  accept?: string;
}> = [];
let respond: (body: unknown) => void = () => {};
// Answer the pending request as an event stream of `frames`. With `hang`, the
// stream then stays open until the request is aborted, as a slow run does.
let respondStream: (frames: string[], hang?: boolean) => void = () => {};

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const code = (content: string) => ({ type: "code", content });

beforeEach(() => {
  requests.length = 0;
  editors.clear();
  state.activeNotebookEditor = undefined;
  state.activeTextEditor = undefined;
  state.workspaceFolders = undefined;
  state.config = {};
  state.documents = [];
  state.onDisk = new Map();
  state.created = 0;
  state.written = [];
  state.statError = undefined;
  state.shown = [];
  state.inserted = [];
  state.afterInsert = undefined;
  state.refuse = undefined;
  state.openError = undefined;
  state.runError = undefined;
  state.duringRun = undefined;
  state.renameListeners = [];
  state.openListeners = [];
  state.closeListeners = [];
  state.fake = {
    notebook: (path, scheme = "file") => notebook(path, [], scheme),
    editor: (nb) => editors.get(nb) ?? editor(nb),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (
        _url: string,
        init: {
          body: string;
          signal: AbortSignal;
          headers: Record<string, string>;
        },
      ) => {
        requests.push({
          body: JSON.parse(init.body),
          signal: init.signal,
          accept: init.headers.Accept,
        });
        const aborted = () => new DOMException("aborted", "AbortError");
        return new Promise((resolve, reject) => {
          respond = (body) =>
            resolve({
              ok: true,
              status: 200,
              headers: { get: () => "application/json" },
              json: async () => body,
            });
          respondStream = (frames, hang = false) => {
            const chunks = frames.map((f) => new TextEncoder().encode(f));
            let index = 0;
            resolve({
              ok: true,
              status: 200,
              headers: { get: () => "text/event-stream" },
              body: {
                getReader: () => ({
                  read: () => {
                    if (index < chunks.length) {
                      return Promise.resolve({
                        done: false,
                        value: chunks[index++],
                      });
                    }
                    if (!hang) {
                      return Promise.resolve({ done: true, value: undefined });
                    }
                    // As with fetch: aborting the request fails the read in
                    // flight.
                    return new Promise((_ok, fail) => {
                      if (init.signal.aborted) {
                        fail(aborted());
                      }
                      init.signal.addEventListener("abort", () =>
                        fail(aborted()),
                      );
                    });
                  },
                  releaseLock: () => {},
                }),
              },
            });
          };
          init.signal.addEventListener("abort", () => reject(aborted()));
        });
      },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("New chat", () => {
  it("ends the run in flight without reporting a stop for it", async () => {
    // Stop's "Stopped." belongs to the conversation New chat throws away;
    // posted after the reset, it would be the first thing in the new one.
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    expect(requests).toHaveLength(1);

    send({ command: "chat-new" });
    await settle();

    expect(requests[0].signal.aborted).toBe(true);
    const commands = posted.map((m) => m.command);
    expect(commands).not.toContain("chat-stopped");
    expect(commands).not.toContain("chat-error");
    expect(posted.at(-1)).toEqual({
      command: "chat-context",
      notebook: "a.ipynb",
    });
  });

  it("ends a request that is still reading the token", async () => {
    // The request used to become the current run only after the token was
    // read, so New chat in that gap ended nothing: the old conversation's
    // request ran on regardless and placed its cells in the notebook.
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    send({ command: "chat-new" });
    await settle();

    expect(requests).toHaveLength(0);
    expect(posted.map((m) => m.command)).toEqual(["chat-context"]);
  });

  it("differs from Stop, which does report the stop", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    send({ command: "chat-stop" });
    await settle();

    expect(posted.map((m) => m.command)).toContain("chat-stopped");
  });

  it("on a tab that is not a notebook, creates one, shows it and pins it", async () => {
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.created).toBe(1);
    // Shown without taking focus, so the next question can be typed at once.
    expect(state.shown).toEqual([
      { path: "Untitled-1.ipynb", preserveFocus: true },
    ]);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb"]);
  });

  it("creates one notebook for two New chats in quick succession", async () => {
    // The second must find the notebook the first created as the active tab.
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    send({ command: "chat-new" });
    await settle();

    expect(state.created).toBe(1);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "Untitled-1.ipynb"]);
  });
});

describe("a notebook created for a chat", () => {
  it("is never written over a file the file system failed to describe", async () => {
    // Writing replaces a file's contents, so only "no such file" frees the
    // name. A file system that answers badly would otherwise cost the user
    // their own Untitled.ipynb.
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    state.onDisk.set(
      "/work/Untitled.ipynb",
      notebook("Untitled.ipynb", [[CODE, "precious()"]]),
    );
    state.statError = new Error("Unavailable");
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.written).toEqual([]);
    expect(contexts(posted)).toEqual([null]);
  });

  it("is not written when the file system refuses to say what is there", async () => {
    // A file system error, but not "no such file": the file may well exist.
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    state.statError = FileSystemError.NoPermissions();
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.written).toEqual([]);
    expect(contexts(posted)).toEqual([null]);
  });

  it("is not written for an error that merely claims the file is missing", async () => {
    // Only VS Code's own FileSystemError is trusted to mean it.
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    state.statError = { code: "FileNotFound" };
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.written).toEqual([]);
    expect(contexts(posted)).toEqual([null]);
  });

  it("is a file in the workspace, so saving it cannot lose the chat", async () => {
    // An untitled notebook gets a new URI when it is saved, and the chat
    // pinned to the old one would lose it.
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.written).toEqual(["/work/Untitled.ipynb"]);
    expect(state.created).toBe(0);
    expect(state.shown).toEqual([
      { path: "/work/Untitled.ipynb", preserveFocus: true },
    ]);
    expect(contexts(posted)).toEqual(["Untitled.ipynb"]);
  });

  it("goes beside the file in the active tab, named like Jupyter's", async () => {
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    state.onDisk.set(
      "/work/src/Untitled.ipynb",
      notebook("src/Untitled.ipynb"),
    );
    state.activeTextEditor = {
      document: { uri: state.uri("file", "/work/src/model.py") },
    };
    const { send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    // Untitled1, as Jupyter numbers them: not Untitled2.
    expect(state.written).toEqual(["/work/src/Untitled1.ipynb"]);
  });

  it("goes in the workspace folder when the active file is outside it", async () => {
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    state.activeTextEditor = {
      document: { uri: state.uri("file", "/elsewhere/notes.py") },
    };
    const { send } = openPanel();

    send({ command: "chat-new" });
    await settle();

    expect(state.written).toEqual(["/work/Untitled.ipynb"]);
  });
});

describe("the conversation's notebook", () => {
  it("is taken at the first message, and holds when the tab changes", async () => {
    const a = notebook("a.ipynb", [
      [CODE, "x = 1"],
      [MARKUP, "## Notes"],
    ]);
    activate(a);
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "one", chatHistory: [] });
    await settle();
    expect(contexts(posted)).toEqual(["a.ipynb"]);
    expect(requests[0].body.notebookCells).toEqual([
      "x = 1",
      "# %% [markdown]\n# ## Notes",
    ]);

    respond({ message: "done", blocks: [] });
    await settle();

    activate(notebook("b.ipynb", [[CODE, "y = 2"]]));
    send({ command: "chat-request", prompt: "two", chatHistory: [] });
    await settle();
    expect(requests[1].body.notebookCells).toEqual([
      "x = 1",
      "# %% [markdown]\n# ## Notes",
    ]);
  });

  it("is created at the first message when the active tab is not a notebook", async () => {
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();

    expect(state.created).toBe(1);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb"]);
    expect(requests).toHaveLength(1);
  });

  it("receives the answer, brought to the front, whichever tab is active", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    activate(notebook("b.ipynb", [[CODE, "y = 2"]]));
    send({ command: "chat-request", prompt: "plot it", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("ds.plot()")] });
    await settle();

    expect(state.shown).toEqual([
      { path: "/work/a.ipynb", preserveFocus: true },
    ]);
    expect(state.inserted.map((i) => i.path)).toEqual(["/work/a.ipynb"]);
  });

  it("is left in the background when an answer has nothing to place", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    activate(notebook("b.ipynb", [[CODE, "y = 2"]]));
    send({ command: "chat-request", prompt: "explain", chatHistory: [] });
    await settle();
    respond({ message: "Just words.", blocks: [] });
    await settle();

    expect(state.shown).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it("is read from its file when closed, and opened again for an answer", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    close(a);
    send({ command: "chat-request", prompt: "more", chatHistory: [] });
    await settle();
    expect(requests[0].body.notebookCells).toEqual(["x = 1"]);
    // Asking a question does not bring it back as a tab.
    expect(state.shown).toEqual([]);

    respond({ message: "Here.", blocks: [code("y = x")] });
    await settle();

    expect(state.shown).toEqual([
      { path: "/work/a.ipynb", preserveFocus: true },
    ]);
    expect(state.inserted.map((i) => i.path)).toEqual(["/work/a.ipynb"]);
    expect(state.created).toBe(0);
    expect(contexts(posted)).toEqual(["a.ipynb"]);
  });

  it("is replaced, once gone, only when an answer has cells to place", async () => {
    // Untitled and closed without saving: nothing left to open again.
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();
    close(state.documents[0]);

    send({ command: "chat-request", prompt: "explain", chatHistory: [] });
    await settle();
    expect(requests[0].body.notebookCells).toBeUndefined();
    respond({ message: "Just words.", blocks: [] });
    await settle();
    expect(state.created).toBe(1);

    send({ command: "chat-request", prompt: "go on", chatHistory: [] });
    await settle();
    expect(state.created).toBe(1);
    respond({ message: "Here.", blocks: [code("x = 1")] });
    await settle();

    expect(state.created).toBe(2);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "Untitled-2.ipynb"]);
    expect(state.inserted.map((i) => i.path)).toEqual(["Untitled-2.ipynb"]);
  });

  it("supplies its own selected cell, never another notebook's", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a, 0);
    const { send } = openPanel();

    send({ command: "chat-new" });
    await settle();
    send({ command: "chat-request", prompt: "fix", chatHistory: [] });
    await settle();
    expect(requests[0].body.codeContext).toBe("x = 1");

    respond({ message: "done", blocks: [] });
    await settle();

    activate(notebook("b.ipynb", [[CODE, "y = 2"]]), 0);
    send({ command: "chat-request", prompt: "fix", chatHistory: [] });
    await settle();
    expect(requests[1].body.codeContext).toBeUndefined();
    expect(requests[1].body.context).toBeUndefined();
  });

  it("follows a rename, rather than losing the notebook and making another", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    move("/work/a.ipynb", "/work/analysis.ipynb");
    close(a);
    send({ command: "chat-request", prompt: "more", chatHistory: [] });
    await settle();

    expect(contexts(posted)).toEqual(["a.ipynb", "analysis.ipynb"]);
    expect(requests[0].body.notebookCells).toEqual(["x = 1"]);
    expect(state.created).toBe(0);
  });

  it("follows a move of the folder holding it", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    move("/work", "/project");
    close(a);
    send({ command: "chat-request", prompt: "more", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("y = x")] });
    await settle();

    expect(state.inserted.map((i) => i.path)).toEqual(["/project/a.ipynb"]);
    expect(state.created).toBe(0);
  });

  it("is followed by a run that is waiting for its answer when renamed", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { send } = openPanel();

    send({ command: "chat-request", prompt: "plot", chatHistory: [] });
    await settle();
    move("/work/a.ipynb", "/work/renamed.ipynb");
    respond({ message: "Here.", blocks: [code("ds.plot()")] });
    await settle();

    expect(state.inserted.map((i) => i.path)).toEqual(["/work/renamed.ipynb"]);
    expect(state.created).toBe(0);
  });
});

describe("placing an answer", () => {
  it("goes below the selected cell when the user is working in the notebook", async () => {
    // They chose the spot.
    const a = notebook("a.ipynb", [
      [CODE, "x = 1"],
      [CODE, "y = 2"],
    ]);
    activate(a, 0);
    const { send } = openPanel();

    send({ command: "chat-request", prompt: "next", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("z = 3")] });
    await settle();

    expect(state.inserted).toEqual([
      { path: "/work/a.ipynb", index: 1, text: "z = 3" },
    ]);
  });

  it("goes at the end when the user is in another tab", async () => {
    // A selection in a notebook they are not looking at is nobody's choice.
    const a = notebook("a.ipynb", [
      [CODE, "x = 1"],
      [CODE, "y = 2"],
    ]);
    activate(a, 0);
    const { send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    activate(notebook("b.ipynb", [[CODE, "q = 0"]]), 0);
    send({ command: "chat-request", prompt: "next", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("z = 3")] });
    await settle();

    expect(state.inserted).toEqual([
      { path: "/work/a.ipynb", index: 2, text: "z = 3" },
    ]);
  });

  it("stays in the notebook when the user switches tab while it lands", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    const b = notebook("b.ipynb", [[CODE, "q = 0"]]);
    activate(a, 0);
    const { send } = openPanel();

    send({ command: "chat-request", prompt: "two steps", chatHistory: [] });
    await settle();
    state.afterInsert = () => {
      state.afterInsert = undefined;
      activate(b, 0);
    };
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(state.inserted).toEqual([
      { path: "/work/a.ipynb", index: 1, text: "one" },
      { path: "/work/a.ipynb", index: 2, text: "two" },
    ]);
  });

  it("keeps an iterating run in the notebook that replaced a lost one", async () => {
    // Every later round would otherwise find the lost notebook still gone,
    // and make another.
    state.config = { autoRunCode: true, iterate: true };
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();
    close(state.documents[0]);

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    respond({ message: "First.", blocks: [code("a = 1")] });
    await settle();
    expect(requests[1].body.runs).toHaveLength(1);

    respond({ message: "Next.", blocks: [code("b = 2")] });
    await settle();
    respond({ message: "Done.", blocks: [] });
    await settle();

    expect(state.created).toBe(2);
    expect(state.inserted.map((i) => i.path)).toEqual([
      "Untitled-2.ipynb",
      "Untitled-2.ipynb",
    ]);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "Untitled-2.ipynb"]);
    expect(posted.at(-1)).toEqual({ command: "chat-done" });
  });
});

describe("an answer's blocks in the chat", () => {
  const unplaced = (posted: Posted[]) =>
    posted.filter((m) => m.command === "chat-unplaced");

  it("are not handed to the chat once they are in the notebook", async () => {
    // The chat showed every code block as well as placing it, so each one
    // appeared twice.
    activate(notebook("a.ipynb"));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    respond({
      message: "Here.",
      blocks: [code("ds = query()"), { type: "markdown", content: "# Notes" }],
    });
    await settle();

    expect(state.inserted.map((i) => i.text)).toEqual([
      "ds = query()",
      "# Notes",
    ]);
    expect(unplaced(posted)).toEqual([]);
    expect(posted.at(-1)).toEqual({ command: "chat-done" });
  });

  it("that the notebook refuses are handed to the chat, and only those", async () => {
    // Otherwise a read-only notebook loses the code: it is not in the notebook,
    // and the chat no longer repeats what it places.
    activate(notebook("a.ipynb"));
    state.refuse = (text) => text === "two";
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    respond({
      message: "Here.",
      blocks: [code("one"), code("two"), code("three")],
    });
    await settle();

    expect(state.inserted.map((i) => i.text)).toEqual(["one", "three"]);
    expect(unplaced(posted)).toEqual([
      { command: "chat-unplaced", blocks: [code("two")] },
    ]);
  });

  it("are all handed to the chat when the notebook cannot be opened", async () => {
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();
    // The conversation's notebook is gone, and making a replacement fails.
    close(state.documents[0]);
    state.openError = new Error("disk full");

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(unplaced(posted)).toEqual([
      { command: "chat-unplaced", blocks: [code("one"), code("two")] },
    ]);
    expect(posted.at(-1)?.command).toBe("chat-error");
  });

  it("that reached the notebook before a failure are not handed to the chat", async () => {
    // "one" is in the notebook when running it fails; only "two" is not.
    state.config = { autoRunCode: true };
    activate(notebook("a.ipynb"));
    state.runError = new Error("kernel died");
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(state.inserted.map((i) => i.text)).toEqual(["one"]);
    expect(unplaced(posted)).toEqual([
      { command: "chat-unplaced", blocks: [code("two")] },
    ]);
  });

  it("that Stop kept out of the notebook are not handed to the chat", async () => {
    // The user chose not to have them.
    activate(notebook("a.ipynb"));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    state.afterInsert = () => {
      state.afterInsert = undefined;
      send({ command: "chat-stop" });
    };
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(state.inserted.map((i) => i.text)).toEqual(["one"]);
    expect(unplaced(posted)).toEqual([]);
    expect(posted.at(-1)).toEqual({ command: "chat-stopped" });
  });

  it("of a run New chat replaced are not handed to the new chat", async () => {
    // New chat is pressed while the notebook is refusing "one"; the old run's
    // leftovers must not land under the new conversation's first answer.
    activate(notebook("a.ipynb"));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    state.refuse = (text) => {
      if (text === "one") {
        send({ command: "chat-new" });
        return true;
      }
      return false;
    };
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(unplaced(posted)).toEqual([]);
  });

  it("that Stop kept out are not handed to the chat when stopping fails the cell", async () => {
    // Cancelling the running cell can throw; that is still the user's Stop,
    // not a failure to place.
    state.config = { autoRunCode: true };
    activate(notebook("a.ipynb"));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "go", chatHistory: [] });
    await settle();
    // Stop arrives while "one" runs, and cancelling it throws.
    state.duringRun = () => send({ command: "chat-stop" });
    state.runError = new Error("cancelled");
    respond({ message: "Here.", blocks: [code("one"), code("two")] });
    await settle();

    expect(state.inserted.map((i) => i.text)).toEqual(["one"]);
    expect(unplaced(posted)).toEqual([]);
    expect(posted.at(-1)).toEqual({ command: "chat-stopped" });
  });
});

describe("an untitled notebook saved as a file", () => {
  it("stays the conversation's notebook, with its cells and its answers", async () => {
    // The usual way to start a notebook in VS Code. Saving gives it a new
    // URI, and no rename event says so.
    state.workspaceFolders = [{ uri: state.uri("file", "/work") }];
    const u = notebook("Untitled-1.ipynb", [[CODE, "x = 1"]], "untitled");
    activate(u);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    saveAs(u, "/work/analysis.ipynb");
    send({ command: "chat-request", prompt: "more", chatHistory: [] });
    await settle();
    expect(requests[0].body.notebookCells).toEqual(["x = 1"]);
    respond({ message: "Here.", blocks: [code("y = x")] });
    await settle();

    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "analysis.ipynb"]);
    expect(state.inserted.map((i) => i.path)).toEqual(["/work/analysis.ipynb"]);
    expect(state.written).toEqual([]);
    expect(state.created).toBe(0);
  });

  it("is followed when saving reformats its cells", async () => {
    // Format on save, or trimming whitespace, rewrites the copy's text before
    // the untitled notebook closes. Its cells stay the same kinds, in order.
    const u = notebook(
      "Untitled-1.ipynb",
      [
        [CODE, "x=1  "],
        [MARKUP, "# Notes"],
      ],
      "untitled",
    );
    activate(u);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    saveAs(u, "/work/analysis.ipynb", (text) =>
      text === "x=1  " ? "x = 1" : text,
    );

    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "analysis.ipynb"]);
  });

  it("follows neither of two notebooks that could be its reformatted copy", async () => {
    // A guess between them could pin the wrong one.
    const u = notebook("Untitled-1.ipynb", [[CODE, "x=1"]], "untitled");
    activate(u);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    activate(notebook("other.ipynb", [[CODE, "y = 2"]]));
    saveAs(u, "/work/analysis.ipynb", () => "x = 1");

    expect(contexts(posted)).toEqual(["Untitled-1.ipynb"]);
  });

  it("is followed by a run waiting for its answer", async () => {
    const u = notebook("Untitled-1.ipynb", [[CODE, "x = 1"]], "untitled");
    activate(u);
    const { send } = openPanel();

    send({ command: "chat-request", prompt: "plot", chatHistory: [] });
    await settle();
    saveAs(u, "/work/analysis.ipynb");
    respond({ message: "Here.", blocks: [code("ds.plot()")] });
    await settle();

    expect(state.inserted.map((i) => i.path)).toEqual(["/work/analysis.ipynb"]);
    expect(state.created).toBe(0);
  });

  it("is not mistaken, when discarded, for a notebook with the same cells opened earlier", async () => {
    // Discarding closes an untitled notebook too. A matching notebook that
    // opened long before is not its copy.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const { posted, send } = openPanel();
    activate(notebook("other.ipynb", [[CODE, "x = 1"]]));
    const u = notebook("Untitled-1.ipynb", [[CODE, "x = 1"]], "untitled");
    activate(u);
    send({ command: "chat-new" });
    await settle();

    vi.setSystemTime(60_000);
    close(u);

    expect(contexts(posted)).toEqual(["Untitled-1.ipynb"]);
  });

  it("is not mistaken, when discarded, for a notebook opened just after it", async () => {
    // The saved copy always opens before the untitled notebook closes, so
    // this one, with the same cells or not, is not it.
    const u = notebook("Untitled-1.ipynb", [[CODE, "x = 1"]], "untitled");
    activate(u);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    close(u);
    activate(notebook("other.ipynb", [[CODE, "x = 1"]]));

    expect(contexts(posted)).toEqual(["Untitled-1.ipynb"]);
  });
});

describe("the context label", () => {
  it("is sent again when the view is shown, since a hidden view receives nothing", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { posted, send, setVisible } = openPanel();
    send({ command: "chat-new" });
    await settle();

    setVisible(false);
    move("/work/a.ipynb", "/work/renamed.ipynb");
    expect(contexts(posted)).toEqual(["a.ipynb"]);

    setVisible(true);
    expect(contexts(posted)).toEqual(["a.ipynb", "renamed.ipynb"]);
  });
});

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const statuses = (posted: Posted[]) =>
  posted.filter((m) => m.command === "chat-status").map((m) => m.progress);

describe("progress while the agent works", () => {
  it("asks for the event stream", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();

    expect(requests[0].accept).toBe("text/event-stream");
  });

  it("shows what the agent is doing, then its answer", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "find waves", chatHistory: [] });
    await settle();
    respondStream([
      frame("status", { phase: "generating" }),
      ": keepalive\n\n",
      frame("status", { phase: "tool", tool: "search_catalog" }),
      frame("done", { message: "Found it.", blocks: [] }),
    ]);
    await settle();

    expect(statuses(posted)).toEqual([
      { phase: "generating" },
      { phase: "tool", tool: "search_catalog" },
    ]);
    expect(posted.filter((m) => m.command === "chat-response")).toEqual([
      {
        command: "chat-response",
        response: { message: "Found it.", blocks: [] },
      },
    ]);
    expect(posted.at(-1)).toEqual({ command: "chat-done" });
  });

  it("takes the answer from done, not from the events before it", async () => {
    // Assembled from the stream, the answer would come out shorter than the
    // agent's whenever a frame went missing, and look complete.
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    respondStream([
      frame("message", { message: "partial" }),
      frame("done", { message: "The whole answer.", blocks: [] }),
    ]);
    await settle();

    expect(posted.find((m) => m.command === "chat-response")).toEqual({
      command: "chat-response",
      response: { message: "The whole answer.", blocks: [] },
    });
  });

  it("reports a failure the stream sends after it has opened", async () => {
    // The status was already 200, so the failure can only arrive as an event.
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    respondStream([
      frame("status", { phase: "generating" }),
      frame("error", {
        detail: "The AI service is unavailable.",
        status_code: 503,
        code: "agent_unavailable",
      }),
    ]);
    await settle();

    expect(posted.at(-1)).toEqual({
      command: "chat-error",
      message: "Backend error: The AI service is unavailable.",
    });
    expect(posted.map((m) => m.command)).not.toContain("chat-response");
  });

  it("fails a stream that ends without its answer", async () => {
    // A dropped connection, or a proxy closing a response that looked idle:
    // shown as a failure, not as a shorter answer.
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    respondStream([frame("status", { phase: "generating" })]);
    await settle();

    expect(posted.at(-1)).toEqual({
      command: "chat-error",
      message: "The response ended before it was complete.",
    });
  });

  it("stops in the middle of the stream", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    respondStream([frame("status", { phase: "generating" })], true);
    await settle();
    send({ command: "chat-stop" });
    await settle();

    expect(requests[0].signal.aborted).toBe(true);
    expect(posted.at(-1)).toEqual({ command: "chat-stopped" });
    expect(posted.map((m) => m.command)).not.toContain("chat-error");
  });

  it("says the code is running while the notebook runs it", async () => {
    // The notebook's turn: the agent's last phase must not stay on screen
    // claiming it is still looking something up.
    state.config = { autoRunCode: true };
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "plot", chatHistory: [] });
    await settle();
    respondStream([
      frame("status", { phase: "tool", tool: "get_datasource_info" }),
      frame("done", { message: "Here.", blocks: [code("ds.plot()")] }),
    ]);
    await settle();

    expect(statuses(posted)).toEqual([
      { phase: "tool", tool: "get_datasource_info" },
      { phase: "running" },
    ]);
  });

  it("says the code is being added when nothing will run", async () => {
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "plot", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("ds.plot()")] });
    await settle();

    expect(statuses(posted)).toEqual([{ phase: "placing" }]);
  });

  it("says the agent is reading the result once the code has run", async () => {
    // An iterate round: without this, "Running the code…" stays up for the
    // whole observe request, and for all of it when that answer is plain JSON.
    state.config = { autoRunCode: true, iterate: true };
    activate(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "plot", chatHistory: [] });
    await settle();
    respond({ message: "Here.", blocks: [code("ds.plot()")] });
    await settle();
    expect(requests).toHaveLength(2);
    respond({ message: "That worked.", blocks: [] });
    await settle();

    expect(statuses(posted)).toEqual([
      { phase: "running" },
      { phase: "interpreting" },
    ]);
    expect(posted.at(-1)).toEqual({ command: "chat-done" });
  });
});
