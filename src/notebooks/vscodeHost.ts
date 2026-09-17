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
      const doc = vscode.window.activeNotebookEditor?.notebook;
      if (!doc || doc.isUntitled) {
        return null;
      }
      if (doc.isDirty && !(await doc.save())) {
        return null;
      }
      return fileAt(doc.uri);
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
