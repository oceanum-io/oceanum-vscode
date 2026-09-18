// Copyright Oceanum Ltd. Apache 2.0
// INotebookHost against the real VS Code API. Deliberately thin: anything with a decision
// in it belongs in storedNotebooks.ts, where it can be tested.
import * as vscode from "vscode";
import { COMMANDS } from "../commands";
import { getValidAccessToken, signedInEmail } from "../auth/session";
import { OCEANUM_DIR } from "../specstore/notebook";
import type {
  INotebookFile,
  INotebookFolder,
  INotebookHost,
} from "./storedNotebooks";

function fileAt(uri: vscode.Uri): INotebookFile {
  return {
    path: uri.path,
    read: async () =>
      new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
    write: async (text: string) =>
      vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text)),
  };
}

/**
 * A notebook document as a file on disk, saved first, or null if it did not get there.
 *
 * A record is linked to its notebook by metadata inside the file, which is how saving it
 * again, renaming it or sharing it later find the record. An untitled notebook has no
 * file to carry that, so saving one asks where to put it first: `save()` on an untitled
 * document is VS Code's Save As. That replaces the untitled tab with the saved file,
 * which becomes the active notebook, so that is what comes back. Declining the dialog
 * leaves everything alone and answers null.
 */
async function notebookFile(
  doc: vscode.NotebookDocument | undefined,
): Promise<INotebookFile | null> {
  if (!doc) {
    return null;
  }
  if (doc.isUntitled) {
    if (!(await doc.save())) {
      return null;
    }
    const saved = vscode.window.activeNotebookEditor?.notebook;
    return saved && !saved.isUntitled ? fileAt(saved.uri) : null;
  }
  if (doc.isDirty && !(await doc.save())) {
    return null;
  }
  return fileAt(doc.uri);
}

export function vscodeHost(context: vscode.ExtensionContext): INotebookHost {
  return {
    accessToken: async () => (await getValidAccessToken(context)) || null,
    email: () => signedInEmail(context),

    async folder(): Promise<INotebookFolder> {
      // Beside the user's work when there is a workspace, so the notebook can see their
      // data files and is theirs to commit; otherwise the extension's own storage.
      const root =
        vscode.workspace.workspaceFolders?.[0]?.uri ?? context.globalStorageUri;
      const dir = vscode.Uri.joinPath(root, OCEANUM_DIR);
      await vscode.workspace.fs.createDirectory(dir);
      return {
        list: async () =>
          (await vscode.workspace.fs.readDirectory(dir))
            .filter(
              ([name, type]) =>
                type === vscode.FileType.File && /\.ipynb$/i.test(name),
            )
            .map(([name]) => name),
        file: (name) => fileAt(vscode.Uri.joinPath(dir, name)),
        show: async (name) => {
          const uri = vscode.Uri.joinPath(dir, name);
          try {
            await vscode.window.showNotebookDocument(
              await vscode.workspace.openNotebookDocument(uri),
            );
          } catch {
            // No notebook support installed (the Jupyter extension provides it). The file
            // is still there, so open it however VS Code can.
            await vscode.commands.executeCommand("vscode.open", uri);
          }
        },
      };
    },

    async activeNotebook(): Promise<INotebookFile | null> {
      return notebookFile(vscode.window.activeNotebookEditor?.notebook);
    },

    async notebookAt(target: string): Promise<INotebookFile | null> {
      const uri = vscode.Uri.parse(target);
      const open = vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.toString() === uri.toString(),
      );
      if (open) {
        return notebookFile(open);
      }
      // Not open as a notebook: it is still a file, and reading it is how everything
      // else here decides whether it is one.
      return /\.ipynb$/i.test(uri.path) ? fileAt(uri) : null;
    },

    pick: async (items, placeholder) =>
      vscode.window.showQuickPick(items, { placeHolder: placeholder }),
    input: async (prompt, placeholder) =>
      vscode.window.showInputBox({
        prompt,
        placeHolder: placeholder,
        ignoreFocusOut: true,
      }),
    info: async (message, ...actions) =>
      vscode.window.showInformationMessage(message, ...actions),
    warn: async (message, ...actions) =>
      vscode.window.showWarningMessage(message, ...actions),
    copy: async (text) => vscode.env.clipboard.writeText(text),
    signIn: async () => {
      await vscode.commands.executeCommand(COMMANDS.LOGIN);
    },
  };
}
