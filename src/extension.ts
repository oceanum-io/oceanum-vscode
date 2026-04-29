// Copyright Oceanum Ltd. Apache 2.0
import * as vscode from "vscode";
import { SidebarProvider } from "./providers/SidebarProvider";
import { DatameshPanel } from "./panels/DatameshPanel";
import { COMMANDS } from "./commands";
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from "./constants";
import { requestDeviceCode, pollForDeviceToken } from "./auth/device";
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
    vscode.commands.registerCommand(COMMANDS.OPEN_DATAMESH, async () => {
      const datameshToken =
        (await context.secrets.get("oceanum.datameshToken")) ??
        vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("datameshToken", "");
      const accessToken =
        (await context.secrets.get("oceanum.accessToken")) ?? "";
      DatameshPanel.createOrShow(
        context,
        onWorkspaceModify,
        datameshToken,
        accessToken,
      );
      if (!accessToken) {
        await vscode.commands.executeCommand(COMMANDS.LOGIN);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.LOGIN, async () => {
      const auth0Domain =
        vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("auth0Domain") || AUTH0_DOMAIN;
      const auth0ClientId =
        vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("auth0ClientId") || AUTH0_CLIENT_ID;
      const auth0Audience =
        vscode.workspace
          .getConfiguration("oceanum")
          .get<string>("auth0Audience") || "";

      if (!auth0ClientId) {
        vscode.window.showErrorMessage(
          "Oceanum: auth0ClientId is not configured. Set oceanum.auth0ClientId in settings.",
        );
        return;
      }

      let deviceCode;
      try {
        deviceCode = await requestDeviceCode({
          domain: auth0Domain,
          clientId: auth0ClientId,
          audience: auth0Audience || undefined,
        });
      } catch (err) {
        vscode.window.showErrorMessage(
          `Oceanum: failed to start device login — ${String(err)}`,
        );
        return;
      }

      console.log(
        "[oceanum-debug] LOGIN: got device code, user_code:",
        deviceCode.user_code,
      );

      const cancellation = new AbortController();
      await vscode.env.openExternal(
        vscode.Uri.parse(deviceCode.verification_uri_complete),
      );

      try {
        const tokenResponse = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Oceanum sign-in — confirm code ${deviceCode.user_code} in your browser`,
            cancellable: true,
          },
          async (_progress, token) => {
            token.onCancellationRequested(() => cancellation.abort());
            return pollForDeviceToken({
              domain: auth0Domain,
              clientId: auth0ClientId,
              deviceCode: deviceCode.device_code,
              intervalSeconds: deviceCode.interval,
              expiresInSeconds: deviceCode.expires_in,
              signal: cancellation.signal,
            });
          },
        );
        console.log(
          "[oceanum-debug] LOGIN: got access_token, length:",
          tokenResponse.access_token.length,
          "panel exists:",
          !!DatameshPanel.instance,
        );
        await context.secrets.store(
          "oceanum.accessToken",
          tokenResponse.access_token,
        );
        if (tokenResponse.refresh_token) {
          await context.secrets.store(
            "oceanum.refreshToken",
            tokenResponse.refresh_token,
          );
        }
        DatameshPanel.instance?.updateAccessToken(tokenResponse.access_token);
        vscode.window.showInformationMessage(
          "Oceanum: signed in successfully.",
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Oceanum: login failed — ${String(err)}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SIGN_OUT, async () => {
      await context.secrets.delete("oceanum.accessToken");
      await context.secrets.delete("oceanum.refreshToken");
      DatameshPanel.instance?.updateAccessToken("");
      vscode.window.showInformationMessage("Oceanum: signed out.");
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
