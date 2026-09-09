// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { harvestOutputs } from "../ai/harvest";
import type { ObservedRun } from "../types";

/**
 * Insert code or markdown into the active notebook or text editor.
 * Priority: active notebook editor → active text editor → clipboard fallback.
 *
 * Returns the notebook cell that was inserted, so the caller can run it. It is
 * the cell rather than its index: a `NotebookCell` follows its cell across
 * later edits, an index does not.
 */
export async function insertContent(
  content: string,
  type: "code" | "markdown",
): Promise<vscode.NotebookCell | null> {
  const notebookEditor = vscode.window.activeNotebookEditor;
  if (notebookEditor) {
    return insertNotebookCell(notebookEditor, content, type);
  }

  const textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    await textEditor.edit((builder) => {
      const pos = textEditor.selection.active;
      builder.insert(pos, content + "\n");
    });
    // A text editor has no cell to run, so there is nothing to report back.
    return null;
  }

  await vscode.env.clipboard.writeText(content);
  vscode.window.showInformationMessage(
    "No active editor — code copied to clipboard.",
  );
  return null;
}

async function insertNotebookCell(
  editor: vscode.NotebookEditor,
  content: string,
  type: "code" | "markdown",
): Promise<vscode.NotebookCell> {
  const notebook = editor.notebook;
  const cellKind =
    type === "markdown"
      ? vscode.NotebookCellKind.Markup
      : vscode.NotebookCellKind.Code;
  const language = type === "markdown" ? "markdown" : "python";

  const insertIndex = editor.selection.end;
  const newCell = new vscode.NotebookCellData(cellKind, content, language);

  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [
    vscode.NotebookEdit.insertCells(insertIndex, [newCell]),
  ]);
  await vscode.workspace.applyEdit(edit);

  // Move selection to the new cell
  editor.selection = new vscode.NotebookRange(insertIndex, insertIndex + 1);
  editor.revealRange(editor.selection);
  return notebook.cellAt(insertIndex);
}

/**
 * Run one notebook cell and report what it produced.
 *
 * The cell is addressed by its own notebook and its index at the moment of
 * the call, not by whichever notebook is active: the user may have clicked
 * elsewhere while an earlier cell ran. `notebook.cell.execute` resolves when
 * the kernel has finished, so the outputs and execution summary on the cell
 * afterwards are this run's. Reading them is what makes the iterate workflow
 * possible: it is the only place the kernel's answer can be seen.
 *
 * Stop cancels the running cell through the same command family, so a long
 * query does not keep the kernel busy after the user gave up on it.
 */
export async function runCellAndHarvest(
  cell: vscode.NotebookCell,
  signal?: AbortSignal,
): Promise<Pick<ObservedRun, "status" | "stdout" | "error">> {
  const target = () => ({
    ranges: [{ start: cell.index, end: cell.index + 1 }],
    document: cell.notebook.uri,
  });
  const cancel = () =>
    void vscode.commands.executeCommand(
      "notebook.cell.cancelExecution",
      target(),
    );
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await vscode.commands.executeCommand("notebook.cell.execute", target());
  } finally {
    signal?.removeEventListener("abort", cancel);
  }

  const harvested = harvestOutputs(cell.outputs.flatMap((o) => o.items));
  const success = cell.executionSummary?.success;
  // The command resolves without running when there is no kernel to run on
  // (the picker was dismissed, or nothing is installed). Empty outputs would
  // then read as a clean, silent run, and the agent would build on it.
  if (success === undefined) {
    return {
      status: "error",
      stdout: harvested.stdout,
      error: "The cell did not run. Is a kernel selected for this notebook?",
    };
  }
  if (success === false && harvested.status === "ok") {
    return {
      status: "error",
      stdout: harvested.stdout,
      error: signal?.aborted
        ? "Execution was stopped."
        : "Execution failed without a traceback.",
    };
  }
  return harvested;
}

/**
 * Collect source from all code cells in the active notebook.
 */
export function getNotebookCells(): string[] {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return [];

  return editor.notebook
    .getCells()
    .filter((cell) => cell.kind === vscode.NotebookCellKind.Code)
    .map((cell) => cell.document.getText())
    .filter((src) => src.trim().length > 0);
}

/**
 * Get the source of the currently selected notebook cell (if any).
 */
export function getActiveCellSource(): {
  source: string;
  isCode: boolean;
} | null {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return null;

  const selection = editor.selection;
  if (selection.isEmpty) return null;

  const cell = editor.notebook.cellAt(selection.start);
  return {
    source: cell.document.getText(),
    isCode: cell.kind === vscode.NotebookCellKind.Code,
  };
}
