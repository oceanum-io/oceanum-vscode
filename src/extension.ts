// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("Oceanum extension active");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let datamesh = vscode.commands.registerCommand("oceanum.datamesh", () => {
    // The code you place here will be executed every time your command is executed
    // Display a message box to the user
    const panel = vscode.window.createWebviewPanel(
      "datamesh-ui", // Identifies the type of the webview. Used internally
      "Datamesh", // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      { enableScripts: true } // Webview options. More on these later.
    );
    panel.webview.html = getWebviewContent();
    panel.webview.onDidReceiveMessage(
      (message) => {
        console.log(message);
      },
      undefined,
      context.subscriptions
    );
  });

  let settings = vscode.commands.registerCommand("oceanum.setToken", () => {
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "oceanum.token"
    );
  });

  context.subscriptions.push(datamesh);
  context.subscriptions.push(settings);
}

// this method is called when your extension is deactivated
export function deactivate() {}

function getWebviewContent() {
  const config = vscode.workspace.getConfiguration("oceanum");

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Cat Coding</title>
  </head>
  <body>
  <iframe sandbox="allow-same-origin allow-scripts allow-popups" src="https://ui.datamesh.oceanum.tech?datamesh_token=${config.token}" width="100%" height="800px">
  </iframe>
  <script>
	(function() {
		const vscode = acquireVsCodeApi();
        // Handle a message from datamesh UI inside the webview and repost to vscode
        window.addEventListener('message', event => {
            const message = event.data; // The JSON data our extension sent
			vscode.postMessage(message)
        });
	}())
    </script>
  </body>
  </html>`;
}
