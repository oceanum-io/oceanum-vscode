// Copyright Oceanum Ltd. Apache 2.0
import { describe, expect, it } from "vitest";

import {
  StoredNotebooks,
  type INotebookFile,
  type INotebookHost,
} from "../notebooks/storedNotebooks";

const SPECS = "https://specs.example.com";
const SITE = "https://notebook.example.com";
const ID = "6f1c1a52-4b8e-4c0f-9a57-1d2e3f4a5b6c";
const NEW_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function notebook(metadata: Record<string, unknown> = {}): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata,
    cells: [{ cell_type: "markdown", metadata: {}, source: ["# hi"] }],
  });
}

const linked = (id: string): string =>
  notebook({ oceanum: { spec_id: id, specs_url: SPECS } });

function summary(id: string, name: string, creator: string | null) {
  return {
    id,
    name,
    description: null,
    modified: "2026-01-02T00:00:00",
    creator,
  };
}

/** A workspace folder, an active notebook, and whatever the user answers. */
function fakeHost(options: {
  email?: string | null;
  files?: Record<string, string>;
  active?: string;
  answers?: string[];
  typed?: string;
}) {
  const files = new Map(Object.entries(options.files ?? {}));
  const answers = [...(options.answers ?? [])];
  const log = {
    shown: [] as string[],
    info: [] as string[],
    warn: [] as string[],
    copied: [] as string[],
    signIns: 0,
  };
  const file = (name: string): INotebookFile => ({
    path: `/work/Oceanum/${name}`,
    read: async () => {
      const text = files.get(name);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    write: async (text: string) => {
      files.set(name, text);
    },
  });
  const host: INotebookHost = {
    accessToken: async () => (options.email === null ? null : "jwt"),
    email: async () =>
      options.email === undefined ? "ada@example.org" : options.email,
    folder: async () => ({
      list: async () => [...files.keys()],
      file,
      show: async (name) => {
        log.shown.push(name);
      },
    }),
    activeNotebook: async () => (options.active ? file(options.active) : null),
    // A tab's context menu names the notebook it meant; here that is a file name.
    notebookAt: async (target: string) =>
      files.has(target) ? file(target) : null,
    pick: async () => answers.shift(),
    input: async () => options.typed,
    info: async (message) => {
      log.info.push(message);
      return answers.shift();
    },
    warn: async (message) => {
      log.warn.push(message);
      return answers.shift();
    },
    copy: async (text) => {
      log.copied.push(text);
    },
    signIn: async () => {
      log.signIns += 1;
    },
  };
  return { host, files, log };
}

/** A spec store that answers from a script and records what it was sent. */
function specStore(...responses: Array<[number, unknown]>) {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchFake = (async (url: string, init: RequestInit) => {
    requests.push({
      method: String(init.method),
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const [status, body] = responses.shift() ?? [500, {}];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { fetchFake, requests };
}

function make(host: INotebookHost, fetchFake: typeof fetch): StoredNotebooks {
  return new StoredNotebooks({
    host,
    specsUrl: SPECS,
    notebookSiteUrl: SITE,
    fetch: fetchFake,
  });
}

describe("acting on the notebook a tab named", () => {
  it("saves the named notebook, not whichever one is active", async () => {
    // Right-clicking a tab does not make it the active editor, so a command from that
    // menu has to act on what it names or it saves the wrong notebook.
    const { host } = fakeHost({
      active: "Active.ipynb",
      files: { "Active.ipynb": notebook(), "Named.ipynb": linked(ID) },
    });
    const { fetchFake, requests } = specStore([
      200,
      { ...summary(ID, "Named", "ada@example.org"), spec: {} },
    ]);

    expect(await make(host, fetchFake).saveActive("Named.ipynb")).toBe(true);

    expect(requests).toHaveLength(1);
    // The linked record of the named file, not a new record for the active one.
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe(`${SPECS}/specs/notebook/${ID}`);
  });

  it("shares the named notebook through its linked record", async () => {
    const { host } = fakeHost({
      active: "Active.ipynb",
      files: { "Active.ipynb": notebook(), "Named.ipynb": linked(ID) },
      answers: ["Anyone with the link can view"],
    });
    const { fetchFake, requests } = specStore(
      [200, { ...summary(ID, "Waves", "ada@example.org"), spec: {} }],
      [200, {}],
    );

    await make(host, fetchFake).shareNotebook("Named.ipynb");

    // Reads the record for its name, then grants on that same id.
    expect(requests.map((r) => r.method)).toEqual(["GET", "POST"]);
    expect(requests[1].url).toBe(`${SPECS}/specs/notebook/${ID}/permissions`);
  });

  it("offers to save a notebook that is not on Oceanum.io before sharing it", async () => {
    const declined = fakeHost({
      files: { "New.ipynb": notebook() },
      answers: [],
    });
    const first = specStore();

    await make(declined.host, first.fetchFake).shareNotebook("New.ipynb");

    // Nothing stored and nothing shared: saying no leaves the notebook alone.
    expect(first.requests).toEqual([]);
    expect(declined.log.info[0]).toContain("not on Oceanum.io yet");
  });
});

describe("rename", () => {
  it("sends the new name and nothing else", async () => {
    const { host, log } = fakeHost({ typed: "Renamed" });
    const { fetchFake, requests } = specStore([
      200,
      { ...summary(ID, "Renamed", "ada@example.org"), spec: {} },
    ]);

    await make(host, fetchFake).rename(ID, "Waves");

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].url).toBe(`${SPECS}/specs/notebook/${ID}`);
    // Only the name: the notebook is never sent back, so a change someone else made
    // to it cannot be overwritten by a rename.
    expect(requests[0].body).toEqual({ name: "Renamed" });
    expect(log.info).toEqual(['Renamed to "Renamed".']);
  });

  it("does nothing when the prompt is dismissed or the name is unchanged", async () => {
    const dismissed = fakeHost({ typed: undefined });
    const first = specStore();
    await make(dismissed.host, first.fetchFake).rename(ID, "Waves");
    expect(first.requests).toEqual([]);

    const same = fakeHost({ typed: "  Waves  " });
    const second = specStore();
    await make(same.host, second.fetchFake).rename(ID, "Waves");
    expect(second.requests).toEqual([]);
  });

  it("reports a failure rather than claiming it renamed anything", async () => {
    const { host, log } = fakeHost({ typed: "Renamed" });
    const { fetchFake } = specStore([403, {}]);

    await make(host, fetchFake).rename(ID, "Waves");

    expect(log.info).toEqual([]);
    expect(log.warn[0]).toContain("Could not rename the notebook");
  });
});

describe("remove", () => {
  it("deletes only after the user says so", async () => {
    const { host, log } = fakeHost({ answers: ["Delete"] });
    const { fetchFake, requests } = specStore([204, null]);

    await make(host, fetchFake).remove(ID, "Waves");

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].url).toBe(`${SPECS}/specs/notebook/${ID}`);
    // The prompt says what is lost, because nothing here can undo it.
    expect(log.warn[0]).toContain("cannot be undone");
    expect(log.info[0]).toContain("Any copy in your workspace was kept");
  });

  it("leaves the record alone when the prompt is dismissed", async () => {
    const { host } = fakeHost({ answers: [] });
    const { fetchFake, requests } = specStore();

    await make(host, fetchFake).remove(ID, "Waves");

    expect(requests).toEqual([]);
  });
});

describe("list", () => {
  it("splits the listing into mine and shared", async () => {
    const { host } = fakeHost({});
    const { fetchFake } = specStore([
      200,
      [
        summary(ID, "Mine", "ada@example.org"),
        // The spec store hides the creator from anyone who is not them.
        summary(NEW_ID, "Theirs", null),
      ],
    ]);

    const state = await make(host, fetchFake).list();

    expect(state).toMatchObject({ state: "ready", email: "ada@example.org" });
    if (state.state !== "ready") throw new Error("unreachable");
    expect(state.mine.map((n) => n.name)).toEqual(["Mine"]);
    expect(state.shared.map((n) => n.name)).toEqual(["Theirs"]);
  });

  it("asks nothing of the spec store when nobody is signed in", async () => {
    const { host } = fakeHost({ email: null });
    const { fetchFake, requests } = specStore();

    expect(await make(host, fetchFake).list()).toEqual({ state: "signed-out" });
    expect(requests).toEqual([]);
  });

  it("treats an expired session as signed out, not as an error to read", async () => {
    const { host } = fakeHost({});
    // The spec store answers a bad or expired token with 400.
    const { fetchFake } = specStore([400, {}]);

    expect(await make(host, fetchFake).list()).toEqual({ state: "signed-out" });
  });

  it("reports any other failure as one", async () => {
    const { host } = fakeHost({});
    const { fetchFake } = specStore([503, {}]);

    expect(await make(host, fetchFake).list()).toMatchObject({
      state: "error",
      message: expect.stringContaining("503"),
    });
  });
});

describe("open", () => {
  const record = {
    ...summary(ID, "Tides", "ada@example.org"),
    spec: JSON.parse(notebook()),
  };

  it("writes the notebook, linked to its record, and opens it", async () => {
    const { host, files, log } = fakeHost({});
    const { fetchFake } = specStore([200, record]);

    await make(host, fetchFake).open(ID);

    expect(log.shown).toEqual(["Tides.ipynb"]);
    const written = JSON.parse(files.get("Tides.ipynb") as string);
    expect(written.metadata.oceanum).toEqual({ spec_id: ID, specs_url: SPECS });
  });

  it("never writes over a different notebook that has the same name", async () => {
    const { host, files, log } = fakeHost({
      files: { "Tides.ipynb": notebook() },
    });
    const { fetchFake } = specStore([200, record]);

    await make(host, fetchFake).open(ID);

    expect(log.shown).toEqual(["Tides (1).ipynb"]);
    // The one that was there is untouched.
    expect(JSON.parse(files.get("Tides.ipynb") as string).metadata).toEqual({});
  });

  it("offers the copy already here rather than replacing it unasked", async () => {
    // It may hold work that was never saved back.
    const mine = linked(ID).replace("# hi", "# my unsaved work");
    const { host, files, log } = fakeHost({
      files: { "Tides.ipynb": mine },
      answers: ["Open my copy"],
    });
    const { fetchFake } = specStore([200, record]);

    await make(host, fetchFake).open(ID);

    expect(log.shown).toEqual(["Tides.ipynb"]);
    expect(files.get("Tides.ipynb")).toBe(mine);
  });

  it("replaces the copy only when told to, and leaves it alone when dismissed", async () => {
    const mine = linked(ID).replace("# hi", "# my unsaved work");
    const dismissed = fakeHost({ files: { "Tides.ipynb": mine }, answers: [] });
    await make(dismissed.host, specStore([200, record]).fetchFake).open(ID);
    expect(dismissed.files.get("Tides.ipynb")).toBe(mine);
    expect(dismissed.log.shown).toEqual([]);

    const replaced = fakeHost({
      files: { "Tides.ipynb": mine },
      answers: ["Replace with the stored version"],
    });
    await make(replaced.host, specStore([200, record]).fetchFake).open(ID);
    expect(replaced.files.get("Tides.ipynb")).not.toContain("my unsaved work");
    expect(replaced.log.shown).toEqual(["Tides.ipynb"]);
  });
});

describe("saveActive", () => {
  it("refuses without a signed-in identity, and offers the way in", async () => {
    // A stored notebook has to belong to someone, and a Datamesh token names nobody.
    const { host, log } = fakeHost({
      email: null,
      files: { "a.ipynb": notebook() },
      active: "a.ipynb",
      answers: ["Sign In"],
    });
    const { fetchFake, requests } = specStore();

    expect(await make(host, fetchFake).saveActive()).toBe(false);

    expect(requests).toEqual([]);
    expect(log.signIns).toBe(1);
    expect(log.warn[0]).toContain("Sign in to Oceanum.io");
  });

  it("creates a record for a new notebook and links the file to it", async () => {
    const { host, files } = fakeHost({
      files: { "a.ipynb": notebook() },
      active: "a.ipynb",
    });
    const { fetchFake, requests } = specStore([
      200,
      { ...summary(NEW_ID, "a", "ada@example.org"), spec: {} },
    ]);

    expect(await make(host, fetchFake).saveActive()).toBe(true);

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `${SPECS}/specs/notebook`,
    });
    expect((requests[0].body as { name: string }).name).toBe("a");
    // So the next save updates this record instead of making another.
    const after = JSON.parse(files.get("a.ipynb") as string);
    expect(after.metadata.oceanum.spec_id).toBe(NEW_ID);
  });

  it("updates the record a linked notebook came from, without storing the link in it", async () => {
    const { host } = fakeHost({
      files: { "a.ipynb": linked(ID) },
      active: "a.ipynb",
    });
    const { fetchFake, requests } = specStore([
      200,
      { ...summary(ID, "a", "ada@example.org"), spec: {} },
    ]);

    expect(await make(host, fetchFake).saveActive()).toBe(true);

    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: `${SPECS}/specs/notebook/${ID}`,
    });
    const sent = requests[0].body as { spec: { metadata: object } };
    expect(sent.spec.metadata).not.toHaveProperty("oceanum");
  });

  it("offers a new record when the old one is gone, and only makes it if asked", async () => {
    const declined = fakeHost({
      files: { "a.ipynb": linked(ID) },
      active: "a.ipynb",
      answers: [],
    });
    const first = specStore([403, {}]);
    expect(await make(declined.host, first.fetchFake).saveActive()).toBe(false);
    expect(first.requests).toHaveLength(1);

    const accepted = fakeHost({
      files: { "a.ipynb": linked(ID) },
      active: "a.ipynb",
      answers: ["Save as a new notebook"],
    });
    const second = specStore(
      [403, {}],
      [200, { ...summary(NEW_ID, "a", "ada@example.org"), spec: {} }],
    );
    expect(await make(accepted.host, second.fetchFake).saveActive()).toBe(true);
    expect(second.requests.map((r) => r.method)).toEqual(["PUT", "POST"]);
    const after = JSON.parse(accepted.files.get("a.ipynb") as string);
    expect(after.metadata.oceanum.spec_id).toBe(NEW_ID);
  });

  it("says so when there is no notebook to save", async () => {
    const { host, log } = fakeHost({});
    expect(await make(host, specStore().fetchFake).saveActive()).toBe(false);
    expect(log.warn[0]).toContain("Open a notebook");
  });
});

describe("share", () => {
  it("grants each address separately and offers the link", async () => {
    const { host, log } = fakeHost({
      answers: ["Share with people…", "Can edit", "Copy link"],
      typed: "Bob@Example.org, carol@example.org",
    });
    const { fetchFake, requests } = specStore([204, null], [204, null]);

    await make(host, fetchFake).share(ID, "Tides");

    expect(requests.map((r) => r.body)).toEqual([
      // Lower-cased: the spec store matches the entity against Auth0's lower-case claim.
      { type: "user", entity: "bob@example.org", permission: "write" },
      { type: "user", entity: "carol@example.org", permission: "write" },
    ]);
    expect(log.copied).toEqual([
      `${SITE}/lab/index.html?oceanum-notebook=${ID}`,
    ]);
  });

  it("shares with nobody when something typed is not an address", async () => {
    // Better than sharing with half a list and leaving the user to work out which half.
    const { host, log } = fakeHost({
      answers: ["Share with people…"],
      typed: "bob@example.org, Carol",
    });
    const { fetchFake, requests } = specStore();

    await make(host, fetchFake).share(ID, "Tides");

    expect(requests).toEqual([]);
    expect(log.warn[0]).toContain("Carol");
  });

  it("names who it could not share with when only some grants fail", async () => {
    const { host, log } = fakeHost({
      answers: ["Share with people…", "Can view"],
      typed: "bob@example.org carol@example.org",
    });
    const { fetchFake } = specStore([204, null], [500, {}]);

    await make(host, fetchFake).share(ID, "Tides");

    expect(log.warn[0]).toContain("carol@example.org");
    expect(log.warn[0]).not.toContain("bob@example.org");
  });

  it("makes a notebook public, and stops it being public", async () => {
    const open = fakeHost({ answers: ["Anyone with the link can view"] });
    const granted = specStore([204, null]);
    await make(open.host, granted.fetchFake).share(ID, "Tides");
    expect(granted.requests[0]).toMatchObject({
      method: "POST",
      body: { type: "public", entity: "", permission: "read" },
    });

    const close = fakeHost({ answers: ["Stop public access"] });
    const revoked = specStore([204, null]);
    await make(close.host, revoked.fetchFake).share(ID, "Tides");
    expect(revoked.requests[0]).toMatchObject({ method: "DELETE" });
  });
});
