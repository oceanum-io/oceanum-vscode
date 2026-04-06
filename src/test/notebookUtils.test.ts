// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so mock variables must use vi.hoisted()
const { mockApplyEdit, mockWriteText, mockShowInformationMessage } = vi.hoisted(
  () => ({
    mockApplyEdit: vi.fn().mockResolvedValue(true),
    mockWriteText: vi.fn().mockResolvedValue(undefined),
    mockShowInformationMessage: vi.fn(),
  }),
);

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
} from "../notebook/notebookUtils";

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
