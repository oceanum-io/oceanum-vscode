// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  activeNotebookEditor: undefined as unknown,
  onClose: undefined as ((notebook: unknown) => void) | undefined,
}));

vi.mock("vscode", () => ({
  window: {
    get activeNotebookEditor() {
      return state.activeNotebookEditor;
    },
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
    }),
    applyEdit: vi.fn(async () => true),
    onDidCloseNotebookDocument: (listener: (notebook: unknown) => void) => {
      state.onClose = listener;
      return { dispose() {} };
    },
  },
  commands: { executeCommand: vi.fn() },
  env: { clipboard: { writeText: vi.fn() } },
  Uri: { joinPath: (...parts: unknown[]) => parts },
  NotebookCellKind: { Markup: 1, Code: 2 },
}));

import { SidebarProvider } from "../providers/SidebarProvider";

const CODE = 2;
const MARKUP = 1;

interface FakeNotebook {
  uri: { path: string };
  isClosed: boolean;
  getCells(): unknown[];
  cellAt(index: number): unknown;
}

function notebook(name: string, cells: Array<[number, string]>): FakeNotebook {
  const made = cells.map(([kind, text]) => ({
    kind,
    document: { getText: () => text },
  }));
  return {
    uri: { path: `/work/${name}` },
    isClosed: false,
    getCells: () => made,
    cellAt: (index: number) => made[index],
  };
}

/** The editor showing `nb`, with cell `selected` selected (or nothing). */
const editor = (nb: FakeNotebook, selected?: number) => ({
  notebook: nb,
  selection:
    selected === undefined
      ? { isEmpty: true, start: 0 }
      : { isEmpty: false, start: selected },
});

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

const requests: Array<{ body: Record<string, unknown>; signal: AbortSignal }> =
  [];
let respond: (body: unknown) => void = () => {};

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  requests.length = 0;
  state.activeNotebookEditor = undefined;
  state.onClose = undefined;
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
    state.activeNotebookEditor = editor(notebook("a.ipynb", [[CODE, "x = 1"]]));
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
    state.activeNotebookEditor = editor(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    send({ command: "chat-new" });
    await settle();

    expect(requests).toHaveLength(0);
    expect(posted.map((m) => m.command)).toEqual(["chat-context"]);
  });

  it("differs from Stop, which does report the stop", async () => {
    state.activeNotebookEditor = editor(notebook("a.ipynb", [[CODE, "x = 1"]]));
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "hi", chatHistory: [] });
    await settle();
    send({ command: "chat-stop" });
    await settle();

    expect(posted.map((m) => m.command)).toContain("chat-stopped");
  });

  it("started from a tab that is not a notebook, gives the chat no notebook", async () => {
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    expect(posted.at(-1)).toEqual({ command: "chat-context", notebook: null });

    // Opening a notebook afterwards does not change this conversation.
    state.activeNotebookEditor = editor(notebook("a.ipynb", [[CODE, "x = 1"]]));
    send({ command: "chat-request", prompt: "q", chatHistory: [] });
    await settle();
    expect(requests[0].body.notebookCells).toBeUndefined();
  });
});

describe("the pinned notebook", () => {
  it("is taken at the first message, and holds when the tab changes", async () => {
    const a = notebook("a.ipynb", [
      [CODE, "x = 1"],
      [MARKUP, "## Notes"],
    ]);
    const b = notebook("b.ipynb", [[CODE, "y = 2"]]);
    state.activeNotebookEditor = editor(a);
    const { posted, send } = openPanel();

    send({ command: "chat-request", prompt: "one", chatHistory: [] });
    await settle();
    expect(posted).toContainEqual({
      command: "chat-context",
      notebook: "a.ipynb",
    });
    expect(requests[0].body.notebookCells).toEqual([
      "x = 1",
      "# %% [markdown]\n# ## Notes",
    ]);

    respond({ message: "done", blocks: [] });
    await settle();

    state.activeNotebookEditor = editor(b);
    send({ command: "chat-request", prompt: "two", chatHistory: [] });
    await settle();
    expect(requests[1].body.notebookCells).toEqual([
      "x = 1",
      "# %% [markdown]\n# ## Notes",
    ]);
  });

  it("is dropped the moment it is closed, and the panel is told", () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    const b = notebook("b.ipynb", [[CODE, "y = 2"]]);
    state.activeNotebookEditor = editor(a);
    const { posted, send } = openPanel();
    send({ command: "chat-new" });

    // Another notebook closing changes nothing.
    state.onClose?.(b);
    expect(posted.at(-1)).toEqual({
      command: "chat-context",
      notebook: "a.ipynb",
    });

    state.onClose?.(a);
    expect(posted.at(-1)).toEqual({ command: "chat-context", notebook: null });
  });

  it("stops being sent once closed", async () => {
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    state.activeNotebookEditor = editor(a);
    const { posted, send } = openPanel();

    send({ command: "chat-new" });
    a.isClosed = true;
    send({ command: "chat-request", prompt: "q", chatHistory: [] });
    await settle();

    expect(posted.at(-1)).toEqual({ command: "chat-context", notebook: null });
    expect(requests[0].body.notebookCells).toBeUndefined();
  });

  it("supplies the selected cell only while it is the active notebook", async () => {
    // Answers are placed in the active notebook, and the server treats a
    // selected code cell as the one its answer replaces.
    const a = notebook("a.ipynb", [[CODE, "x = 1"]]);
    const b = notebook("b.ipynb", [[CODE, "y = 2"]]);
    state.activeNotebookEditor = editor(a, 0);
    const { send } = openPanel();

    send({ command: "chat-new" });
    send({ command: "chat-request", prompt: "fix", chatHistory: [] });
    await settle();
    expect(requests[0].body.codeContext).toBe("x = 1");

    respond({ message: "done", blocks: [] });
    await settle();

    state.activeNotebookEditor = editor(b, 0);
    send({ command: "chat-request", prompt: "fix", chatHistory: [] });
    await settle();
    expect(requests[1].body.codeContext).toBeUndefined();
    expect(requests[1].body.context).toBeUndefined();
  });
});
