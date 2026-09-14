// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { readSse } from "../ai/sse";

/**
 * A stand-in for a response body. `readSse` uses exactly three things from one
 * -- `getReader()`, then `read()` and `releaseLock()` -- so this supplies those
 * and nothing else. It also gives the tests what they need: control of where
 * one chunk ends and the next begins, which the network decides and the parser
 * has to survive.
 */
function chunkedStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return {
    getReader: () => ({
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> =>
        index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
      releaseLock: (): void => undefined,
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return chunkedStream(chunks.map((chunk) => encoder.encode(chunk)));
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<Array<{ event: string; data: string }>> {
  const out: Array<{ event: string; data: string }> = [];
  for await (const event of readSse(stream, signal)) {
    out.push({ event: event.event, data: event.data });
  }
  return out;
}

describe("readSse", () => {
  it("reads one event per frame", async () => {
    const events = await collect(
      streamOf(
        'event: status\ndata: {"phase":"generating"}\n\n',
        'event: done\ndata: {"message":"hi"}\n\n',
      ),
    );

    expect(events).toEqual([
      { event: "status", data: '{"phase":"generating"}' },
      { event: "done", data: '{"message":"hi"}' },
    ]);
  });

  it("keeps the event's id", async () => {
    // The backend numbers events within a stream: a position, for reporting
    // how far a run got.
    const events: Array<string | undefined> = [];
    for await (const event of readSse(
      streamOf('id: 3\nevent: done\ndata: {"message":"hi"}\n\n'),
    )) {
      events.push(event.id);
    }

    expect(events).toEqual(["3"]);
  });

  it("reassembles a frame split across chunks", async () => {
    // The network splits wherever it likes; a frame is not a packet.
    const events = await collect(
      streamOf("event: sta", 'tus\ndata: {"pha', 'se":"generating"}\n\n'),
    );

    expect(events).toEqual([
      { event: "status", data: '{"phase":"generating"}' },
    ]);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    // A UTF-8 sequence has no obligation to arrive whole. Decoding each chunk
    // independently mangles it.
    const payload = '{"tool":"café"}';
    const bytes = new TextEncoder().encode(
      `event: status\ndata: ${payload}\n\n`,
    );
    const split = bytes.indexOf(0xc3); // the first byte of "é"

    const events = await collect(
      chunkedStream([bytes.slice(0, split + 1), bytes.slice(split + 1)]),
    );

    expect(events).toEqual([{ event: "status", data: payload }]);
  });

  it("ignores keepalive comments", async () => {
    // The backend sends these during a long wait. They carry nothing, and a
    // client that treated one as an event would show a blank status.
    const events = await collect(
      streamOf(": keepalive\n\n", 'event: done\ndata: {"message":"hi"}\n\n'),
    );

    expect(events).toEqual([{ event: "done", data: '{"message":"hi"}' }]);
  });

  it("drops a frame with no data rather than yielding an empty one", async () => {
    const events = await collect(
      streamOf("event: status\n\n", "event: done\ndata: {}\n\n"),
    );

    expect(events).toEqual([{ event: "done", data: "{}" }]);
  });

  it("stops when the signal is aborted", async () => {
    // Stop must end the read, not merely stop the caller looking at it.
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamOf('event: done\ndata: {"message":"hi"}\n\n'),
      controller.signal,
    );

    expect(events).toEqual([]);
  });
});

describe("line endings other than LF", () => {
  // The spec allows CRLF, bare CR and LF. Our backend sends LF, but anything in
  // between may rewrite them, and the failure if it does is TOTAL: the frame
  // separator never matches and zero events parse.

  it("reads a CRLF stream", async () => {
    const events = await collect(
      streamOf(
        'event: status\r\ndata: {"phase":"generating"}\r\n\r\n',
        'event: done\r\ndata: {"message":"hi"}\r\n\r\n',
      ),
    );

    expect(events).toEqual([
      { event: "status", data: '{"phase":"generating"}' },
      { event: "done", data: '{"message":"hi"}' },
    ]);
  });

  it("reads a bare-CR stream, final frame included", async () => {
    const events = await collect(
      streamOf('event: done\rdata: {"message":"hi"}\r\r'),
    );

    expect(events).toEqual([{ event: "done", data: '{"message":"hi"}' }]);
  });

  it("does not invent a frame when a CRLF is split across chunks", async () => {
    // A chunk ending in `\r` whose `\n` arrives next must not be converted
    // early: that manufactures a blank line, a frame boundary never sent.
    const events = await collect(
      streamOf('event: done\r\ndata: {"message":"hi"}\r', "\n\r\n"),
    );

    expect(events).toEqual([{ event: "done", data: '{"message":"hi"}' }]);
  });

  it("leaves no carriage return in the payload", async () => {
    // A stray `\r` on the data would break JSON.parse for the caller.
    const events = await collect(
      streamOf('event: done\r\ndata: {"message":"hi"}\r\n\r\n'),
    );

    expect(events[0].data).not.toContain("\r");
    expect(() => JSON.parse(events[0].data)).not.toThrow();
  });
});
