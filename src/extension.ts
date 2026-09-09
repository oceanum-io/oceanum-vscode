// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { SidebarProvider } from "./providers/SidebarProvider";
import { DatameshPanel } from "./panels/DatameshPanel";
import { COMMANDS } from "./commands";
import type { IWorkspaceSpec } from "./types";

/**
 * Drop the credentials the Auth0 device login stored before 0.4.0.
 *
 * The extension authenticates with the Datamesh token alone, so an access and
 * refresh token from an earlier version are credentials with no owner: nothing
 * reads them, and a refresh token stays usable until it is revoked. Deleting a
 * key that is not there is a no-op, so this costs three lookups once per
 * session and is safe to run forever.
 */
async function clearLegacyAuth0Secrets(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete("oceanum.accessToken");
  await context.secrets.delete("oceanum.refreshToken");
  await context.secrets.delete("oceanum.accessTokenExpiry");
}

export function activate(context: vscode.ExtensionContext): void {
  clearLegacyAuth0Secrets(context).catch((err: unknown) => {
    // Secret storage is not always there: Linux without a working keyring,
    // some remote sessions. Failing to delete credentials nothing reads is not
    // worth failing activation over, but it should not be a silent unhandled
    // rejection either.
    console.warn("[oceanum] could not clear legacy Auth0 secrets:", err);
  });

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
    vscode.commands.registerCommand(COMMANDS.OPEN_DATAMESH, async () => {
      const datameshToken =
        (await context.secrets.get("oceanum.datameshToken")) ??
        vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("datameshToken", "");
      DatameshPanel.createOrShow(context, onWorkspaceModify, datameshToken);
      if (!datameshToken) {
        // The nudge the device login used to give, pointed at the credential
        // the panel actually needs.
        await vscode.commands.executeCommand(COMMANDS.SET_TOKEN);
      }
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
