// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so mock variables must use vi.hoisted()
const {
  mockApplyEdit,
  mockWriteText,
  mockShowInformationMessage,
  mockExecuteCommand,
} = vi.hoisted(() => ({
  mockApplyEdit: vi.fn().mockResolvedValue(true),
  mockWriteText: vi.fn().mockResolvedValue(undefined),
  mockShowInformationMessage: vi.fn(),
  mockExecuteCommand: vi.fn().mockResolvedValue(undefined),
}));

const mockNotebookEditor = {
  notebook: {
    uri: { toString: () => "file:///test.ipynb" },
    getCells: vi.fn(),
    cellAt: vi.fn(),
  },
  selection: { start: 2, end: 2, isEmpty: false },
  revealRange: vi.fn(),
};

let activeNotebookEditor: typeof mockNotebookEditor | undefined;
let activeTextEditor:
  | {
      selection: { active: unknown };
      edit: (fn: (b: unknown) => void) => Promise<boolean>;
    }
  | undefined;

vi.mock("vscode", () => ({
  window: {
    get activeNotebookEditor() {
      return activeNotebookEditor;
    },
    get activeTextEditor() {
      return activeTextEditor;
    },
    showInformationMessage: mockShowInformationMessage,
  },
  env: { clipboard: { writeText: mockWriteText } },
  workspace: { applyEdit: mockApplyEdit },
  commands: { executeCommand: mockExecuteCommand },
  NotebookCellKind: { Code: 2, Markup: 1 },
  NotebookCellData: vi
    .fn()
    .mockImplementation((kind, content, lang) => ({ kind, content, lang })),
  NotebookEdit: {
    insertCells: vi.fn().mockReturnValue({ type: "insertCells" }),
  },
  NotebookRange: vi.fn().mockImplementation((start, end) => ({ start, end })),
  WorkspaceEdit: vi.fn().mockImplementation(() => ({ set: vi.fn() })),
}));

import {
  insertContent,
  getNotebookCells,
  getActiveCellSource,
  runCellAndHarvest,
} from "../notebook/notebookUtils";
import { STDOUT_MIME } from "../ai/harvest";
import type * as vscode from "vscode";

beforeEach(() => {
  vi.clearAllMocks();
  activeNotebookEditor = undefined;
  activeTextEditor = undefined;
});

describe("insertContent", () => {
  it("inserts a notebook cell when a notebook editor is active", async () => {
    activeNotebookEditor =
      mockNotebookEditor as unknown as typeof mockNotebookEditor;
    await insertContent('print("hello")', "code");
    expect(mockApplyEdit).toHaveBeenCalledOnce();
  });

  it("inserts at cursor when only a text editor is active", async () => {
    const insertMock = vi.fn();
    const editMock = vi.fn().mockImplementation((fn) => {
      fn({ insert: insertMock });
      return Promise.resolve(true);
    });
    activeTextEditor = {
      selection: { active: { line: 0, character: 0 } },
      edit: editMock,
    };
    await insertContent("x = 1", "code");
    expect(editMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(expect.anything(), "x = 1\n");
  });

  it("copies to clipboard when no editor is active", async () => {
    await insertContent("x = 1", "code");
    expect(mockWriteText).toHaveBeenCalledWith("x = 1");
    expect(mockShowInformationMessage).toHaveBeenCalledOnce();
  });

  it("returns no cell when the notebook refuses the edit, so nothing else gets run", async () => {
    activeNotebookEditor =
      mockNotebookEditor as unknown as typeof mockNotebookEditor;
    mockApplyEdit.mockResolvedValueOnce(false);
    mockNotebookEditor.notebook.cellAt.mockReturnValue({ index: 2 });
    expect(await insertContent("x = 1", "code")).toBeNull();
    expect(mockNotebookEditor.notebook.cellAt).not.toHaveBeenCalled();
  });
});

describe("runCellAndHarvest", () => {
  const uri = { toString: () => "file:///other.ipynb" };
  const fakeCell = (over: Record<string, unknown> = {}) =>
    ({
      index: 3,
      notebook: { uri },
      outputs: [
        {
          items: [
            { mime: STDOUT_MIME, data: new TextEncoder().encode("hi\n") },
          ],
        },
      ],
      executionSummary: { success: true },
      ...over,
    }) as unknown as vscode.NotebookCell;

  it("runs the cell in ITS notebook, at its current index, and harvests", async () => {
    const out = await runCellAndHarvest(fakeCell());
    expect(mockExecuteCommand).toHaveBeenCalledWith("notebook.cell.execute", {
      ranges: [{ start: 3, end: 4 }],
      document: uri,
    });
    expect(out).toEqual({ status: "ok", stdout: "hi\n", error: null });
  });

  it("reports a cell that never ran as an error, not a silent success", async () => {
    const out = await runCellAndHarvest(
      fakeCell({ outputs: [], executionSummary: undefined }),
    );
    expect(out.status).toBe("error");
    expect(out.error).toMatch(/did not run/);
  });

  it("Stop cancels the running cell", async () => {
    const controller = new AbortController();
    mockExecuteCommand.mockImplementationOnce(async (cmd: string) => {
      if (cmd === "notebook.cell.execute") {
        controller.abort();
      }
    });
    const out = await runCellAndHarvest(
      fakeCell({ outputs: [], executionSummary: { success: false } }),
      controller.signal,
    );
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "notebook.cell.cancelExecution",
      { ranges: [{ start: 3, end: 4 }], document: uri },
    );
    expect(out).toEqual({
      status: "error",
      stdout: "",
      error: "Execution was stopped.",
    });
  });

  it("does not run a cell at all when Stop already happened", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await runCellAndHarvest(fakeCell(), controller.signal);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
    expect(out).toEqual({
      status: "error",
      stdout: "",
      error: "Execution was stopped.",
    });
  });

  it("reports stopped, not 'no kernel', when Stop lands before the cell started", async () => {
    const controller = new AbortController();
    mockExecuteCommand.mockImplementationOnce(async () => {
      controller.abort();
    });
    const out = await runCellAndHarvest(
      fakeCell({ outputs: [], executionSummary: undefined }),
      controller.signal,
    );
    expect(out.error).toBe("Execution was stopped.");
  });
});

describe("getNotebookCells", () => {
  it("returns empty array when no notebook is open", () => {
    expect(getNotebookCells()).toEqual([]);
  });

  it("returns source of non-empty code cells", () => {
    mockNotebookEditor.notebook.getCells.mockReturnValue([
      { kind: 2, document: { getText: () => "import pandas" } },
      { kind: 1, document: { getText: () => "# markdown" } },
      { kind: 2, document: { getText: () => "   " } }, // blank — filtered out
      { kind: 2, document: { getText: () => 'df = pd.read_csv("f.csv")' } },
    ]);
    activeNotebookEditor =
      mockNotebookEditor as unknown as typeof mockNotebookEditor;
    expect(getNotebookCells()).toEqual([
      "import pandas",
      'df = pd.read_csv("f.csv")',
    ]);
  });
});

describe("getActiveCellSource", () => {
  it("returns null when no notebook is open", () => {
    expect(getActiveCellSource()).toBeNull();
  });

  it("returns source and isCode=true for a code cell", () => {
    mockNotebookEditor.notebook.cellAt.mockReturnValue({
      kind: 2,
      document: { getText: () => "x = 1" },
    });
    activeNotebookEditor =
      mockNotebookEditor as unknown as typeof mockNotebookEditor;
    expect(getActiveCellSource()).toEqual({ source: "x = 1", isCode: true });
  });

  it("returns isCode=false for a markdown cell", () => {
    mockNotebookEditor.notebook.cellAt.mockReturnValue({
      kind: 1,
      document: { getText: () => "# heading" },
    });
    activeNotebookEditor =
      mockNotebookEditor as unknown as typeof mockNotebookEditor;
    expect(getActiveCellSource()).toEqual({
      source: "# heading",
      isCode: false,
    });
  });

  it("returns null when selection is empty", () => {
    const emptySelectionEditor = {
      ...mockNotebookEditor,
      selection: { start: 0, end: 0, isEmpty: true },
    };
    activeNotebookEditor =
      emptySelectionEditor as unknown as typeof mockNotebookEditor;
    expect(getActiveCellSource()).toBeNull();
  });
});
