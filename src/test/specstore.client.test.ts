// Copyright Oceanum Ltd. Apache 2.0
import { describe, expect, it, vi } from 'vitest';

import { SpecStoreClient, SpecStoreError } from '../specstore/client';
import type { ISpecBody } from '../specstore/notebook';

const ID = '6f1c1a52-4b8e-4c0f-9a57-1d2e3f4a5b6c';
const SERVER_ID = '0b7d9f2e-1111-4a2b-8c3d-9e8f7a6b5c4d';

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };

function record(id: string = ID) {
  return {
    id,
    name: 'Waves',
    description: null,
    modified: '2026-09-12T10:00:00',
    creator: 'a@example.com',
    spec: notebook
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function setup(
  response: () => Response | Promise<Response>,
  token: string | null = 'tok'
) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    response()
  );
  const client = new SpecStoreClient({
    specsUrl: 'https://specs.example.com/',
    getAccessToken: async () => token,
    fetch
  });
  const call = (i = 0) => {
    const [url, init] = fetch.mock.calls[i];
    return {
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
    };
  };
  return { client, fetch, call };
}

const body: ISpecBody = { name: 'Waves', description: null, spec: notebook };

describe('SpecStoreClient', () => {
  it('lists with the bearer token', async () => {
    const { client, call } = setup(() => json([record()]));
    const items = await client.list();
    expect(items).toHaveLength(1);
    expect(call()).toEqual({
      url: 'https://specs.example.com/specs/notebook',
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
      body: undefined
    });
  });

  it('requires sign-in to list, without calling the server', async () => {
    const { client, fetch } = setup(() => json([]), null);
    await expect(client.list()).rejects.toMatchObject({ kind: 'signed-out' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gets a record anonymously when signed out', async () => {
    const { client, call } = setup(() => json(record()), null);
    const result = await client.get(ID);
    expect(result.id).toBe(ID);
    expect(call().url).toBe(`https://specs.example.com/specs/notebook/${ID}`);
    expect(call().headers).toEqual({});
  });

  it('refuses ids that are not UUIDs before building a URL', async () => {
    const { client, fetch } = setup(() => json(record()));
    await expect(client.get('../eidos')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(client.update('x/permissions', body)).rejects.toBeInstanceOf(
      SpecStoreError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates with a JSON body, never sends an id, and uses the server id', async () => {
    const { client, call } = setup(() => json(record(SERVER_ID)));
    const withId = { ...body, id: ID } as ISpecBody;
    const result = await client.create(withId);
    expect(result.id).toBe(SERVER_ID);
    expect(call()).toEqual({
      url: 'https://specs.example.com/specs/notebook',
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: { name: 'Waves', description: null, spec: notebook }
    });
  });

  it('updates with PUT to the record URL', async () => {
    const { client, call } = setup(() => json(record()));
    await client.update(ID, body);
    expect(call().method).toBe('PUT');
    expect(call().url).toBe(`https://specs.example.com/specs/notebook/${ID}`);
    expect(call().body).toEqual(body);
  });

  it('posts permission grants', async () => {
    const { client, call } = setup(() => json([]));
    await client.addPermission(ID, {
      type: 'user',
      entity: 'b@example.com',
      permission: 'write'
    });
    await client.addPermission(ID, { type: 'public', entity: '', permission: 'read' });
    expect(call(0).url).toBe(
      `https://specs.example.com/specs/notebook/${ID}/permissions`
    );
    expect(call(0).method).toBe('POST');
    expect(call(0).body).toEqual({
      type: 'user',
      entity: 'b@example.com',
      permission: 'write'
    });
    expect(call(1).body).toEqual({ type: 'public', entity: '', permission: 'read' });
  });

  it('deletes a permission by repeating the exact grant', async () => {
    const { client, call } = setup(() => json([]));
    await client.removePermission(ID, { type: 'public', entity: '', permission: 'read' });
    expect(call(0).url).toBe(
      `https://specs.example.com/specs/notebook/${ID}/permissions`
    );
    expect(call(0).method).toBe('DELETE');
    expect(call(0).body).toEqual({ type: 'public', entity: '', permission: 'read' });
  });

  it.each([
    [400, 'expired', 'Your Oceanum session has expired, sign in again.'],
    [403, 'forbidden', /another organisation/],
    [404, 'not-found', /no longer exists/],
    [413, 'too-large', /too large/],
    [500, 'server', 'Oceanum.io returned an error (HTTP 500).']
  ])('maps HTTP %i to %s', async (status, kind, message) => {
    const { client } = setup(() => json('Forbidden', status));
    const error = await client.get(ID).catch(e => e);
    expect(error).toBeInstanceOf(SpecStoreError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toMatch(message);
  });

  it('maps a network failure', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(client.create(body)).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringMatching(/Could not reach Oceanum.io/)
    });
  });

  it('rejects malformed responses', async () => {
    const { client } = setup(() => json({ id: 'nope', name: 1 }));
    await expect(client.get(ID)).rejects.toMatchObject({ kind: 'invalid' });
    const list = setup(() => json({ detail: 'x' }));
    await expect(list.client.list()).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('asks for a fresh token on every request', async () => {
    const getAccessToken = vi.fn(async () => 'tok');
    const client = new SpecStoreClient({
      specsUrl: 'https://specs.example.com',
      getAccessToken,
      fetch: async () => json(record())
    });
    await client.get(ID);
    await client.get(ID);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});
