// Copyright Oceanum Ltd. Apache 2.0
// Notebooks stored on Oceanum.io: listing, opening, saving and sharing them.
//
// Everything VS Code-shaped is behind INotebookHost, so what is here can be tested as plain
// logic; src/notebooks/vscodeHost.ts is the real implementation.
import {
  SpecStoreClient,
  SpecStoreError,
  type PermissionGrant,
  type SharePermission,
} from "../specstore/client";
import {
  METADATA_KEY,
  buildSpecBody,
  notebookFromRecord,
  parseShareEmails,
  partitionSummaries,
  readLink,
  reportForShareFailures,
  sanitizeName,
  type INotebookContent,
  type ISpecSummary,
} from "../specstore/notebook";

/** What the Notebooks tab shows. */
export type NotebooksState =
  | { state: "signed-out" }
  | {
      state: "ready";
      email: string;
      mine: ISpecSummary[];
      shared: ISpecSummary[];
    }
  | { state: "error"; email: string; message: string };

/** A notebook file the host can read and replace. */
export interface INotebookFile {
  /** For messages, and for the name a new record is given. */
  readonly path: string;
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

/** The folder opened notebooks are written to. */
export interface INotebookFolder {
  /** File names (not paths) of the notebooks already in it. */
  list(): Promise<string[]>;
  file(name: string): INotebookFile;
  /** Open the named notebook in an editor. */
  show(name: string): Promise<void>;
}

export interface INotebookHost {
  /** A current Oceanum.io access token, or null when not signed in. */
  accessToken(): Promise<string | null>;
  /** Who is signed in, or null. */
  email(): Promise<string | null>;
  folder(): Promise<INotebookFolder>;
  /** The notebook in the active editor, saved to disk first, or null if there is none. */
  activeNotebook(): Promise<INotebookFile | null>;
  pick(items: string[], placeholder: string): Promise<string | undefined>;
  input(prompt: string, placeholder: string): Promise<string | undefined>;
  /** Resolves to the action chosen, if any. */
  info(message: string, ...actions: string[]): Promise<string | undefined>;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  copy(text: string): Promise<void>;
  signIn(): Promise<void>;
}

export interface IStoredNotebooksOptions {
  host: INotebookHost;
  /** Spec store base URL, e.g. `https://specs.oceanum.io`. */
  specsUrl: string;
  /** Where a shared notebook opens for someone without this extension. */
  notebookSiteUrl: string;
  fetch?: typeof fetch;
}

const SIGN_IN = "Sign In";
const OPEN_LOCAL = "Open my copy";
const REPLACE = "Replace with the stored version";
const SAVE_AS_NEW = "Save as a new notebook";
const COPY_LINK = "Copy link";

const SHARE_PEOPLE = "Share with people…";
const SHARE_PUBLIC = "Anyone with the link can view";
const STOP_PUBLIC = "Stop public access";
const CAN_VIEW = "Can view";
const CAN_EDIT = "Can edit";

export class StoredNotebooks {
  constructor(options: IStoredNotebooksOptions) {
    this._host = options.host;
    this._specsUrl = options.specsUrl;
    this._siteUrl = options.notebookSiteUrl;
    this._client = new SpecStoreClient({
      specsUrl: options.specsUrl,
      getAccessToken: () => this._host.accessToken(),
      fetch: options.fetch,
    });
  }

  /** The user's notebooks and those shared with them, for the sidebar. */
  async list(): Promise<NotebooksState> {
    const email = await this._host.email();
    if (!email) {
      return { state: "signed-out" };
    }
    try {
      const { mine, shared } = partitionSummaries(
        await this._client.list(),
        email,
      );
      return { state: "ready", email, mine, shared };
    } catch (err) {
      if (needsSignIn(err)) {
        return { state: "signed-out" };
      }
      return { state: "error", email, message: messageOf(err) };
    }
  }

  /** Bring a stored notebook into the workspace and open it. */
  async open(id: string): Promise<void> {
    let content: INotebookContent;
    let name: string;
    try {
      const record = await this._client.get(id);
      content = notebookFromRecord(record, this._specsUrl);
      name = record.name;
    } catch (err) {
      await this._report(err, "Could not open the notebook");
      return;
    }

    const folder = await this._host.folder();
    const existing = await folder.list();
    const local = await this._localCopyOf(id, folder, existing);
    let fileName: string;
    if (local) {
      // The local copy may hold work that was never saved back. Replacing it is the
      // user's call, never a side effect of clicking a name in a list.
      const choice = await this._host.info(
        `You already have a copy of "${name}" here (${local}).`,
        OPEN_LOCAL,
        REPLACE,
      );
      if (!choice) {
        return;
      }
      fileName = local;
      if (choice === OPEN_LOCAL) {
        await folder.show(fileName);
        return;
      }
    } else {
      fileName = uniqueName(name, existing);
    }
    await folder.file(fileName).write(serialise(content));
    await folder.show(fileName);
  }

  /**
   * Save the active notebook to Oceanum.io. Returns whether anything was stored, so the
   * caller knows whether the list changed.
   */
  async saveActive(): Promise<boolean> {
    // A stored notebook belongs to a person, so there has to be one. A Datamesh token is
    // not enough: it identifies an account's access, not who is using it.
    if (!(await this._host.email())) {
      const choice = await this._host.warn(
        "Sign in to Oceanum.io to save notebooks there. A Datamesh token does not identify you, and a stored notebook has to belong to someone.",
        SIGN_IN,
      );
      if (choice === SIGN_IN) {
        await this._host.signIn();
      }
      return false;
    }

    const file = await this._host.activeNotebook();
    if (!file) {
      await this._host.warn(
        "Open a notebook that is saved to disk, then save it to Oceanum.io.",
      );
      return false;
    }

    let content: INotebookContent;
    try {
      content = JSON.parse(await file.read()) as INotebookContent;
    } catch {
      await this._host.warn(`${file.path} is not a notebook that can be read.`);
      return false;
    }

    const built = buildSpecBody(content, file.path, this._specsUrl);
    if (!built.ok) {
      await this._host.warn(
        `This notebook is too large for Oceanum.io even without its outputs (${megabytes(built.bytes)} MB; the limit is 30 MB).`,
      );
      return false;
    }

    const link = readLink(content.metadata?.[METADATA_KEY], this._specsUrl);
    try {
      if (link) {
        await this._client.update(link.spec_id, built.body);
      } else {
        await this._createAndLink(file, content, built.body);
      }
    } catch (err) {
      // The record is gone, or was someone else's and their grant has ended. Saving under
      // a new id is the only way forward, and it changes what the file points at, so ask.
      if (link && isGone(err)) {
        const choice = await this._host.warn(
          `${messageOf(err)} You can keep your work by saving it as a new notebook of your own.`,
          SAVE_AS_NEW,
        );
        if (choice !== SAVE_AS_NEW) {
          return false;
        }
        try {
          await this._createAndLink(file, content, built.body);
        } catch (again) {
          await this._report(again, "Could not save the notebook");
          return false;
        }
      } else {
        await this._report(err, "Could not save the notebook");
        return false;
      }
    }

    await this._host.info(
      built.strippedOutputs
        ? `Saved "${built.body.name}" to Oceanum.io without its outputs, which made it too large to store.`
        : `Saved "${built.body.name}" to Oceanum.io.`,
    );
    return true;
  }

  /** Share a stored notebook with people, or with anyone who has the link. */
  async share(id: string, name: string): Promise<void> {
    const how = await this._host.pick(
      [SHARE_PEOPLE, SHARE_PUBLIC, STOP_PUBLIC],
      `Share "${name}"`,
    );
    if (!how) {
      return;
    }

    if (how === STOP_PUBLIC) {
      try {
        await this._client.removePermission(id, PUBLIC);
        await this._host.info(`"${name}" is no longer public.`);
      } catch (err) {
        await this._report(err, "Could not stop public access");
      }
      return;
    }

    let grants: PermissionGrant[];
    if (how === SHARE_PUBLIC) {
      grants = [PUBLIC];
    } else {
      const typed = await this._host.input(
        "Who should have access? Separate addresses with commas, spaces or new lines.",
        "alice@example.com, bob@example.com",
      );
      if (typed === undefined) {
        return;
      }
      const { emails, invalid } = parseShareEmails(typed);
      if (invalid.length > 0) {
        await this._host.warn(
          `Not shared with anyone yet: ${invalid.join(", ")} ${invalid.length === 1 ? "is not an email address" : "are not email addresses"}. Use bare addresses, without names.`,
        );
        return;
      }
      if (emails.length === 0) {
        return;
      }
      const level = await this._host.pick(
        [CAN_VIEW, CAN_EDIT],
        `What can they do with "${name}"?`,
      );
      if (!level) {
        return;
      }
      const permission: SharePermission = level === CAN_EDIT ? "write" : "read";
      grants = emails.map((entity) => ({ type: "user", entity, permission }));
    }

    // The spec store takes one grant per request, so one failing must not stop the rest.
    const failed: Array<{ grant: PermissionGrant; error: unknown }> = [];
    for (const grant of grants) {
      try {
        await this._client.addPermission(id, grant);
      } catch (error) {
        failed.push({ grant, error });
      }
    }

    if (failed.length > 0) {
      const report = reportForShareFailures(
        grants.length,
        failed.map(({ grant }) => grant.entity),
        failed.some(({ error }) => needsSignIn(error)),
      );
      if (report.kind === "partial") {
        await this._host.warn(
          `Shared "${name}", but not with ${report.named.join(", ")}: ${messageOf(failed[0].error)}`,
        );
      } else {
        await this._report(failed[0].error, "Could not share the notebook");
      }
      if (failed.length === grants.length) {
        return;
      }
    }

    const link = this._shareLink(id);
    const choice = await this._host.info(
      how === SHARE_PUBLIC
        ? `Anyone with the link can now view "${name}".`
        : `Shared "${name}". They will find it under "Shared with me", or you can send them the link.`,
      COPY_LINK,
    );
    if (choice === COPY_LINK) {
      await this._host.copy(link);
    }
  }

  private _shareLink(id: string): string {
    const url = new URL(
      "lab/index.html",
      `${this._siteUrl.replace(/\/+$/, "")}/`,
    );
    url.searchParams.set("oceanum-notebook", id);
    return url.toString();
  }

  private async _createAndLink(
    file: INotebookFile,
    content: INotebookContent,
    body: Parameters<SpecStoreClient["create"]>[0],
  ): Promise<void> {
    const record = await this._client.create(body);
    // Point the file at its new record, so the next save updates it rather than making
    // another. The server mints the id, so it can only be written after the fact.
    const linked: INotebookContent = {
      ...content,
      metadata: {
        ...content.metadata,
        [METADATA_KEY]: { spec_id: record.id, specs_url: this._specsUrl },
      },
    };
    await file.write(serialise(linked));
  }

  /** The file in `folder` already linked to record `id`, if any. */
  private async _localCopyOf(
    id: string,
    folder: INotebookFolder,
    names: string[],
  ): Promise<string | null> {
    for (const name of names) {
      try {
        const content = JSON.parse(
          await folder.file(name).read(),
        ) as INotebookContent;
        const link = readLink(content.metadata?.[METADATA_KEY], this._specsUrl);
        if (link?.spec_id === id) {
          return name;
        }
      } catch {
        // Not JSON, or unreadable: not a copy of anything.
      }
    }
    return null;
  }

  private async _report(err: unknown, what: string): Promise<void> {
    if (needsSignIn(err)) {
      const choice = await this._host.warn(
        `${what}: ${messageOf(err)}`,
        SIGN_IN,
      );
      if (choice === SIGN_IN) {
        await this._host.signIn();
      }
      return;
    }
    await this._host.warn(`${what}: ${messageOf(err)}`);
  }

  private readonly _host: INotebookHost;
  private readonly _specsUrl: string;
  private readonly _siteUrl: string;
  private readonly _client: SpecStoreClient;
}

const PUBLIC: PermissionGrant = {
  type: "public",
  entity: "",
  permission: "read",
};

function needsSignIn(err: unknown): boolean {
  return (
    err instanceof SpecStoreError &&
    (err.kind === "signed-out" || err.kind === "expired")
  );
}

function isGone(err: unknown): boolean {
  return (
    err instanceof SpecStoreError &&
    (err.kind === "forbidden" || err.kind === "not-found")
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** ipynb's conventional one-space indent, with the trailing newline Jupyter writes. */
function serialise(content: INotebookContent): string {
  return `${JSON.stringify(content, null, 1)}\n`;
}

/** `<name>.ipynb`, or `<name> (1).ipynb` and so on, avoiding what is already there. */
function uniqueName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((entry) => entry.toLowerCase()));
  const base = sanitizeName(name);
  let candidate = `${base}.ipynb`;
  for (let i = 1; taken.has(candidate.toLowerCase()); i++) {
    candidate = `${base} (${i}).ipynb`;
  }
  return candidate;
}
