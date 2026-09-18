// Copyright Oceanum Ltd. Apache 2.0
import React from "react";
import { vscode } from "../vscode";
import { formatModified } from "../notebooks";
import type { NotebooksState, StoredNotebook } from "../types";

function NotebookRow({
  notebook,
  owned,
}: {
  notebook: StoredNotebook;
  /** Whether this is the user's own record, which is what the actions below need. */
  owned: boolean;
}): React.ReactElement {
  const open = (): void =>
    vscode.postMessage({ command: "notebook-open", id: notebook.id });
  const act = (command: "notebook-share" | "notebook-rename" | "notebook-delete") =>
    vscode.postMessage({ command, id: notebook.id, name: notebook.name });
  return (
    <div className="notebook-item" title={notebook.description ?? undefined}>
      <button className="notebook-item-name" onClick={open}>
        {notebook.name}
      </button>
      <span className="notebook-item-modified">
        {formatModified(notebook.modified)}
      </span>
      {/* Sharing, renaming and deleting all need admin access to the record, which only
          its owner has. Each asks before it does anything, so none of them acts on a
          stray click. */}
      {owned && (
        <>
          <button
            className="notebook-item-share"
            title={`Share "${notebook.name}"`}
            aria-label={`Share ${notebook.name}`}
            onClick={() => act("notebook-share")}
          >
            Share
          </button>
          <button
            className="notebook-item-share"
            title={`Rename "${notebook.name}"`}
            aria-label={`Rename ${notebook.name}`}
            onClick={() => act("notebook-rename")}
          >
            Rename
          </button>
          <button
            className="notebook-item-share"
            title={`Delete "${notebook.name}" from Oceanum.io`}
            aria-label={`Delete ${notebook.name}`}
            onClick={() => act("notebook-delete")}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  notebooks,
  owned,
}: {
  title: string;
  empty: string;
  notebooks: StoredNotebook[];
  owned: boolean;
}): React.ReactElement {
  return (
    <section>
      <div className="workspace-name">{title}</div>
      {notebooks.length === 0 ? (
        <div className="oceanum-empty">{empty}</div>
      ) : (
        notebooks.map((notebook) => (
          <NotebookRow key={notebook.id} notebook={notebook} owned={owned} />
        ))
      )}
    </section>
  );
}

export function NotebooksPanel({
  notebooks,
  canSave,
}: {
  /** Null until the extension has answered the first time. */
  notebooks: NotebooksState | null;
  /**
   * Whether "Save current notebook" has anything to do: someone is signed in to save it
   * for, and the tab on top is a notebook.
   */
  canSave: boolean;
}): React.ReactElement {
  if (notebooks === null) {
    return <div className="oceanum-empty">Loading…</div>;
  }

  if (notebooks.state === "signed-out") {
    return (
      <div className="oceanum-empty">
        <p>
          Notebooks stored on Oceanum.io belong to you, so listing, saving and
          sharing them needs you to sign in. A Datamesh token is not enough: it
          says what an account may access, not who is using it.
        </p>
        <button
          className="notebooks-action"
          onClick={() => vscode.postMessage({ command: "sign-in" })}
        >
          Sign in to Oceanum.io
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-panel">
      <div className="notebooks-toolbar">
        <button
          className="notebooks-action"
          disabled={!canSave}
          title={
            canSave
              ? "Save the notebook in the active editor to Oceanum.io"
              : "Open a notebook, and sign in, to save it to Oceanum.io"
          }
          onClick={() => vscode.postMessage({ command: "notebook-save" })}
        >
          Save current notebook
        </button>
        <button
          className="notebooks-link"
          onClick={() => vscode.postMessage({ command: "notebooks-refresh" })}
        >
          Refresh
        </button>
      </div>

      {notebooks.state === "error" ? (
        // Never the sections as well: their empty messages would claim the account has no
        // notebooks when the load simply failed.
        <div className="chat-error">{notebooks.message}</div>
      ) : (
        <>
          <Section
            title="My notebooks"
            empty="Nothing saved yet. Open a notebook and choose Save current notebook."
            notebooks={notebooks.mine}
            owned={true}
          />
          <Section
            title="Shared with me"
            empty="Nothing has been shared with you."
            notebooks={notebooks.shared}
            owned={false}
          />
        </>
      )}

      <div className="notebooks-account">
        {notebooks.email}
        {" · "}
        <button
          className="notebooks-link"
          onClick={() => vscode.postMessage({ command: "sign-out" })}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
