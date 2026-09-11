// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface FakeUri {
  scheme: string;
  path: string;
  toString(): string;
}

interface FakeNotebook {
  uri: FakeUri;
  isClosed: boolean;
  getCells(): unknown[];
  cellAt(index: number): unknown;
}

interface FakeEditor {
  notebook: FakeNotebook;
  selection: { isEmpty: boolean; start: number; end: number };
  revealRange(): void;
}

const state = vi.hoisted(() => ({
  activeNotebookEditor: undefined as unknown,
  documents: [] as unknown[],
  onDisk: new Map<string, unknown>(),
  created: 0,
  shown: [] as Array<{ path: string; preserveFocus?: boolean }>,
  applied: [] as Array<{ path: string }>,
  makeNotebook: undefined as
    | ((
        name: string,
        cells: Array<[number, string]>,
        scheme?: string,
      ) => unknown)
    | undefined,
  makeEditor: undefined as ((notebook: unknown) => unknown) | undefined,
}));

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
  class WorkspaceEdit {
    entries: Array<{ uri: { path: string } }> = [];
    set(uri: { path: string }) {
      this.entries.push({ uri });
    }
  }
  return {
    window: {
      get activeNotebookEditor() {
        return state.activeNotebookEditor;
      },
      get visibleNotebookEditors() {
        return state.activeNotebookEditor ? [state.activeNotebookEditor] : [];
      },
      showNotebookDocument: vi.fn(
        async (
          notebook: { uri: { path: string } },
          options?: { preserveFocus?: boolean },
        ) => {
          state.shown.push({
            path: notebook.uri.path,
            preserveFocus: options?.preserveFocus,
          });
          const shown = state.makeEditor!(notebook);
          // With preserveFocus the focus stays where it was, and so does the
          // active editor: placement must go through the editor it showed,
          // not through whichever one happens to be active.
          if (!options?.preserveFocus) {
            state.activeNotebookEditor = shown;
          }
          return shown;
        },
      ),
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => fallback,
      }),
      get notebookDocuments() {
        return state.documents;
      },
      openNotebookDocument: vi.fn(async (what: unknown) => {
        if (typeof what === "string") {
          state.created += 1;
          const fresh = state.makeNotebook!(
            `Untitled-${state.created}.ipynb`,
            [],
            "untitled",
          );
          state.documents.push(fresh);
          return fresh;
        }
        const found = state.onDisk.get((what as { path: string }).path) as
          { isClosed: boolean } | undefined;
        if (!found) {
          throw new Error("no such file");
        }
        found.isClosed = false;
        state.documents.push(found);
        return found;
      }),
      applyEdit: vi.fn(
        async (edit: { entries: Array<{ uri: { path: string } }> }) => {
          for (const entry of edit.entries) {
            state.applied.push({ path: entry.uri.path });
          }
          return true;
        },
      ),
    },
    commands: { executeCommand: vi.fn() },
    env: { clipboard: { writeText: vi.fn() } },
    Uri: { joinPath: (...parts: unknown[]) => parts },
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
  };
});

import { SidebarProvider } from "../providers/SidebarProvider";

const CODE = 2;
const MARKUP = 1;

function notebook(
  name: string,
  cells: Array<[number, string]>,
  scheme = "file",
): FakeNotebook {
  const made = cells.map(([kind, text]) => ({
    kind,
    document: { getText: () => text },
  }));
  const path = scheme === "untitled" ? name : `/work/${name}`;
  return {
    uri: { scheme, path, toString: () => `${scheme}:${path}` },
    isClosed: false,
    getCells: () => made,
    cellAt: (index: number) =>
      made[index] ?? { kind: CODE, document: { getText: () => "" } },
  };
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

/** Open `nb` in the active tab. */
function activate(nb: FakeNotebook, selected?: number): void {
  if (!state.documents.includes(nb)) {
    state.documents.push(nb);
  }
  state.activeNotebookEditor = editor(nb, selected);
}

/** Close `nb`'s tab; saved to disk unless it is untitled. */
function close(nb: FakeNotebook): void {
  nb.isClosed = true;
  state.documents = state.documents.filter((d) => d !== nb);
  if (nb.uri.scheme === "file") {
    state.onDisk.set(nb.uri.path, nb);
  }
  if ((state.activeNotebookEditor as FakeEditor | undefined)?.notebook === nb) {
    state.activeNotebookEditor = undefined;
  }
}

type Posted = { command: string; [key: string]: unknown };

function openPanel() {
  const posted: Posted[] = [];
  let receive: (msg: unknown) => void = () => {};
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "",
      asWebviewUri: (uri: unknown) => uri,
      postMessage: (msg: Posted) => {
        posted.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: (msg: unknown) => void) => {
        receive = listener;
        return { dispose() {} };
      },
    },
    onDidDispose: () => ({ dispose() {} }),
  };
  const provider = new SidebarProvider({
    extensionUri: {},
    secrets: { get: async () => "a-token" },
  } as never);
  provider.resolveWebviewView(view as never, {} as never, {} as never);
  return { posted, send: (msg: unknown) => receive(msg) };
}

const contexts = (posted: Posted[]) =>
  posted.filter((m) => m.command === "chat-context").map((m) => m.notebook);

const requests: Array<{ body: Record<string, unknown>; signal: AbortSignal }> =
  [];
let respond: (body: unknown) => void = () => {};

const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  requests.length = 0;
  editors.clear();
  state.activeNotebookEditor = undefined;
  state.documents = [];
  state.onDisk = new Map();
  state.created = 0;
  state.shown = [];
  state.applied = [];
  state.makeNotebook = (name, cells, scheme) => notebook(name, cells, scheme);
  state.makeEditor = (nb) =>
    editors.get(nb as FakeNotebook) ?? editor(nb as FakeNotebook);
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: { body: string; signal: AbortSignal }) => {
      requests.push({ body: JSON.parse(init.body), signal: init.signal });
      return new Promise((resolve, reject) => {
        respond = (body) =>
          resolve({ ok: true, status: 200, json: async () => body });
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(state.shown.map((s) => s.path)).toEqual(["Untitled-1.ipynb"]);
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
    respond({
      message: "Here.",
      blocks: [{ type: "code", content: "ds.plot()" }],
    });
    await settle();

    expect(state.shown).toEqual([
      { path: "/work/a.ipynb", preserveFocus: true },
    ]);
    expect(state.applied).toEqual([{ path: "/work/a.ipynb" }]);
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
    expect(state.applied).toEqual([]);
  });

  it("is opened again when it has been closed", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    activate(a);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();

    close(a);
    send({ command: "chat-request", prompt: "more", chatHistory: [] });
    await settle();
    expect(requests[0].body.notebookCells).toEqual(["x = 1"]);

    respond({ message: "Here.", blocks: [{ type: "code", content: "y = x" }] });
    await settle();

    expect(state.shown.at(-1)).toEqual({
      path: "/work/a.ipynb",
      preserveFocus: true,
    });
    expect(state.applied).toEqual([{ path: "/work/a.ipynb" }]);
    expect(state.created).toBe(0);
    expect(contexts(posted)).toEqual(["a.ipynb"]);
  });

  it("is replaced by a new notebook when it was untitled and closed without saving", async () => {
    const { posted, send } = openPanel();
    send({ command: "chat-new" });
    await settle();
    close(state.documents[0] as FakeNotebook);

    send({ command: "chat-request", prompt: "go on", chatHistory: [] });
    await settle();

    expect(state.created).toBe(2);
    expect(contexts(posted)).toEqual(["Untitled-1.ipynb", "Untitled-2.ipynb"]);
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
});
