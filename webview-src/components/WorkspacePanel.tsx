// Copyright Oceanum Ltd. Apache 2.0
import React from "react";
import { vscode } from "../vscode";
import { DatasourceItem } from "./DatasourceItem";
import type { IWorkspaceSpec } from "../types";

export function WorkspacePanel({
  spec,
}: {
  spec: IWorkspaceSpec | null;
}): React.ReactElement {
  if (!spec) {
    return (
      <div className="oceanum-empty">
        <a
          onClick={() => vscode.postMessage({ command: "open-datamesh" })}
          href="#"
        >
          Open Datamesh UI
        </a>{" "}
        to add datasources to your workspace.
      </div>
    );
  }

  return (
    <div className="workspace-panel">
      <div className="workspace-name">{spec.name}</div>
      {spec.data.length === 0 ? (
        <div className="oceanum-empty">No datasources in workspace.</div>
      ) : (
        spec.data.map((ds) => <DatasourceItem key={ds.id} datasource={ds} />)
      )}
    </div>
  );
}
