// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { harvestOutputs } from "../ai/harvest";
import type { ObservedRun } from "../types";
import { formatNotebookCells, type ContextCell } from "./cellContext";

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

/**
 * Insert one cell into the notebook `editor` is showing, below its selection,
 * and select it.
 */
export async function insertNotebookCell(
  editor: vscode.NotebookEditor,
  content: string,
  type: "code" | "markdown",
): Promise<vscode.NotebookCell | null> {
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
  // A refused edit (read-only or closed notebook) leaves whatever cell was at
  // `insertIndex`; returning it would run the user's own cell as the agent's.
  // Say so: the chat still shows the code, and nothing else explains why it
  // never appeared in the notebook.
  if (!(await vscode.workspace.applyEdit(edit))) {
    vscode.window.showWarningMessage(
      "Could not insert into the notebook — it may be read-only or closed.",
    );
    return null;
  }

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
  const stopped = (
    stdout = "",
  ): Pick<ObservedRun, "status" | "stdout" | "error"> => ({
    status: "error",
    stdout,
    error: "Execution was stopped.",
  });
  // Stop can land while the cell is still being inserted; the abort listener
  // below never fires for a signal that is already aborted.
  if (signal?.aborted) {
    return stopped();
  }
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
  // A cancelled cell may end with no summary at all (stopped while queued)
  // or with a KeyboardInterrupt traceback. The run is discarded either way,
  // so the reason is what matters, not the kernel's account of it.
  if (signal?.aborted) {
    return stopped(harvested.stdout);
  }
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
      error: "Execution failed without a traceback.",
    };
  }
  return harvested;
}

/**
 * Collect source from all code cells in the active notebook.
 */
export function getNotebookCells(): string[] {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    return [];
  }

  return editor.notebook
    .getCells()
    .filter((cell) => cell.kind === vscode.NotebookCellKind.Code)
    .map((cell) => cell.document.getText())
    .filter((src) => src.trim().length > 0);
}

/**
 * The cells of `notebook` as chat context: code and markdown, in order. See
 * formatNotebookCells for the shape and for how the server's limits are kept.
 */
export function notebookCellsOf(notebook: vscode.NotebookDocument): string[] {
  const cells: ContextCell[] = notebook.getCells().map((cell) => ({
    kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
    source: cell.document.getText(),
  }));
  return formatNotebookCells(cells);
}

/**
 * Get the source of the currently selected notebook cell (if any).
 */
export function getActiveCellSource(): {
  source: string;
  isCode: boolean;
} | null {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    return null;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    return null;
  }

  const cell = editor.notebook.cellAt(selection.start);
  return {
    source: cell.document.getText(),
    isCode: cell.kind === vscode.NotebookCellKind.Code,
  };
}

/**
 * The selected cell of `notebook`, from whichever editor is showing it, or
 * null when no editor shows it or nothing is selected.
 */
export function selectedCellIn(
  notebook: vscode.NotebookDocument,
): { source: string; isCode: boolean } | null {
  const editor = [
    vscode.window.activeNotebookEditor,
    ...vscode.window.visibleNotebookEditors,
  ].find((e) => e?.notebook === notebook);
  if (!editor || editor.selection.isEmpty) {
    return null;
  }
  const cell = notebook.cellAt(editor.selection.start);
  return {
    source: cell.document.getText(),
    isCode: cell.kind === vscode.NotebookCellKind.Code,
  };
}
