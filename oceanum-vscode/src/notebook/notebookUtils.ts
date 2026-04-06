// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";

/**
 * Insert code or markdown into the active notebook or text editor.
 * Priority: active notebook editor → active text editor → clipboard fallback.
 */
export async function insertContent(
  content: string,
  type: "code" | "markdown",
): Promise<void> {
  const notebookEditor = vscode.window.activeNotebookEditor;
  if (notebookEditor) {
    await insertNotebookCell(notebookEditor, content, type);
    return;
  }

  const textEditor = vscode.window.activeTextEditor;
  if (textEditor) {
    await textEditor.edit((builder) => {
      const pos = textEditor.selection.active;
      builder.insert(pos, content + "\n");
    });
    return;
  }

  await vscode.env.clipboard.writeText(content);
  vscode.window.showInformationMessage(
    "No active editor — code copied to clipboard.",
  );
}

async function insertNotebookCell(
  editor: vscode.NotebookEditor,
  content: string,
  type: "code" | "markdown",
): Promise<void> {
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
