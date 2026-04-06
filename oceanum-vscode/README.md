# Oceanum VS Code Extension

Oceanum Datamesh and AI integration for Visual Studio Code. Browse ocean and environmental datasets from the [Oceanum Datamesh](https://oceanum.io), insert ready-to-run Python connector code into notebooks and editors, and chat with Oceanum AI to query and analyse data.

## Features

### Datamesh Sidebar

The Oceanum panel in the Activity Bar shows your current Datamesh workspace — the set of datasets you have selected in the Datamesh UI. Each datasource can be:

- **Inserted** into the active notebook cell or text editor as a Python `Connector` code snippet (click the insert button or drag to a cell)
- **Expanded** to inspect its datasource ID, variables, time filter, geo filter, and spatial reference

### Datamesh UI

Open the full Datamesh browser (`Oceanum: Open Datamesh UI` command or the `+` button in the sidebar) to search and filter the entire Datamesh catalogue. Selecting a workspace in the UI automatically populates the sidebar datasource list.

### Generated Code

For a simple datasource the extension generates:

```python
from oceanum.datamesh import Connector
datamesh = Connector()
my_dataset = datamesh.load_datasource('my-dataset-id')
```

For a datasource with filters (variables, time range, geo filter, spatial reference):

```python
from oceanum.datamesh import Connector
datamesh = Connector()
my_dataset = datamesh.query(
  datasource='my-dataset-id',
  variables=['ssh', 'u', 'v'],
  timefilter={'times': ['2020-01-01', '2021-01-01']},
  geofilter={'type': 'Point', 'coordinates': [170.5, -45.0]}
)
```

### Oceanum AI Chat

The AI panel at the bottom of the sidebar lets you ask natural-language questions about Datamesh data. The AI reads your current notebook cells as context and inserts generated code directly into the active cell.

## Requirements

- VS Code 1.80 or later
- A [Datamesh API token](https://home.oceanum.io/account) (free account required)
- Python with `oceanum` installed (`pip install oceanum`) to run generated code

## Configuration

| Setting | Description | Default |
|---|---|---|
| `oceanum.datameshToken` | Datamesh API token | `""` |
| `oceanum.injectToken` | Add `DATAMESH_TOKEN=''` to generated code | `false` |

### Setting your token (recommended)

Run **Oceanum: Configure Token** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). The token is stored in VS Code's encrypted secrets store — not in `settings.json`.

Alternatively, paste it directly into `oceanum.datameshToken` in Settings (`File → Preferences → Settings`), though this stores it in plain text.

## Commands

| Command | Description |
|---|---|
| `Oceanum: Open Datamesh UI` | Open the Datamesh browser panel |
| `Oceanum: Configure Token` | Set your Datamesh token securely |

---

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/oceanum-io/oceanum-vscode
cd oceanum-vscode
npm install
```

### Build

```bash
# Development build (with source maps)
npm run compile

# Watch mode — rebuilds on every file save
npm run watch
```

Two bundles are produced:

| Bundle | Entry | Output | Purpose |
|---|---|---|---|
| Extension host | `src/extension.ts` | `out/extension.js` | Node.js, CommonJS |
| Sidebar webview | `webview-src/index.tsx` | `out/sidebar.js` | Browser, IIFE |

### Run in VS Code

1. Open the repo in VS Code
2. Press `F5` — this opens an **Extension Development Host** window with the extension loaded
3. The Oceanum icon appears in the Activity Bar of the new window

Rebuild with `npm run compile` (or keep `npm run watch` running) and press `Ctrl+R` / `Cmd+R` in the Extension Development Host to reload.

### Tests

```bash
# Run once
npm test

# Watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev). The `vscode` module is mocked — no VS Code process is required to run tests.

### Lint

```bash
npm run lint
```

---

## Building and Installing Locally

Package the extension as a `.vsix` file:

```bash
npm run package
```

This runs a production build then calls `vsce package`, producing `oceanum-vscode-<version>.vsix` in the repo root.

Install it in VS Code:

```bash
code --install-extension oceanum-vscode-0.1.0.vsix
```

Or via the UI: **Extensions → ··· menu → Install from VSIX**.

---

## Publishing

### VS Code Marketplace

1. Create a publisher at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/manage)
2. Generate a Personal Access Token (PAT) with **Marketplace → Manage** scope
3. Store it as `VSCE_PAT` in your GitHub repository secrets

Publish manually:

```bash
export VSCE_PAT=<your-pat>
npm run publish:marketplace
```

Or push a version tag to trigger the CI workflow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Open VSX Registry (VS Codium / Gitpod)

Store an Open VSX token as `OVSX_PAT` in GitHub secrets, then:

```bash
export OVSX_TOKEN=<your-token>
npm run publish:ovsx
```

The CI workflow publishes to both registries automatically on version tags.

### Bumping the version

```bash
# patch / minor / major
npm version patch
git push --follow-tags
```

---

## Architecture

```
src/
  extension.ts          # Activation entry point — wires commands and providers
  commands.ts           # Command ID constants
  types.ts              # Shared TypeScript interfaces and message union types
  constants.ts          # API and service URLs
  panels/
    DatameshPanel.ts    # WebviewPanel: Datamesh UI iframe + workspace-modify relay
  providers/
    SidebarProvider.ts  # WebviewViewProvider: sidebar React app host
  notebook/
    notebookUtils.ts    # Insert cells into notebooks or text editors
  codegen/
    datasourceCodegen.ts  # Python connector code generation
  utils/
    nonce.ts            # CSP nonce generation

webview-src/            # React app for the sidebar WebviewView
  index.tsx             # Entry point
  ...
```

**Cross-component message flow:**

```
Datamesh iframe
  → (postMessage workspace-modify)
  → DatameshPanel relay script
  → extension host (onDidReceiveMessage)
  → SidebarProvider.sendWorkspaceUpdate()
  → sidebar React app (window message event)
```

AI chat requests flow in the opposite direction, from the sidebar webview through the extension host (which makes the `https://ai.oceanum.io` fetch — avoiding browser CORS restrictions), then back to the webview and into the active notebook.

## License

Apache 2.0 — Copyright Oceanum Ltd.
