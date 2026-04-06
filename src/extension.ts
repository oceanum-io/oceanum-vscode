// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { SidebarProvider } from "./providers/SidebarProvider";
import { DatameshPanel } from "./panels/DatameshPanel";
import { COMMANDS } from "./commands";
import type { IWorkspaceSpec } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const sidebarProvider = new SidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "oceanum.sidebar",
      sidebarProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  const onWorkspaceModify = (spec: IWorkspaceSpec): void => {
    sidebarProvider.sendWorkspaceUpdate(spec);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_DATAMESH, () => {
      DatameshPanel.createOrShow(context, onWorkspaceModify);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SET_TOKEN, async () => {
      const token = await vscode.window.showInputBox({
        prompt: "Enter your Oceanum Datamesh token",
        password: true,
        placeHolder: "Paste your token here",
        ignoreFocusOut: true,
      });
      if (token !== undefined) {
        await context.secrets.store("oceanum.datameshToken", token);
        sidebarProvider.invalidateToken();
        sidebarProvider.sendTokenStatus(!!token);
        DatameshPanel.instance?.updateToken(token);
        vscode.window.showInformationMessage("Oceanum: token saved securely.");
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("oceanum.datameshToken")) {
        const token = vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("datameshToken", "");
        sidebarProvider.invalidateToken();
        sidebarProvider.sendTokenStatus(!!token);
        DatameshPanel.instance?.updateToken(token);
      }
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically
}
