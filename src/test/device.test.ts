// Copyright Oceanum Ltd. Apache 2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pollForDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
} from "../auth/device";

/** Answers each fetch from a script, recording what was sent. */
function auth0(...responses: Array<[number, unknown]>) {
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    requests.push({ url, body: new URLSearchParams(init.body) });
    const [status, body] = responses.shift() ?? [500, {}];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

const TOKENS = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  token_type: "Bearer",
};

const POLL = {
  domain: "auth.example",
  clientId: "client",
  deviceCode: "SECRET",
  intervalSeconds: 5,
  expiresInSeconds: 900,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("requestDeviceCode", () => {
  it("asks for an identity and a refresh token, and an audience only when given one", async () => {
    const requests = auth0(
      [200, { device_code: "d" }],
      [200, { device_code: "d" }],
    );

    await requestDeviceCode({ domain: "auth.example", clientId: "client" });
    await requestDeviceCode({
      domain: "auth.example",
      clientId: "client",
      audience: "https://api.example",
    });

    expect(requests[0].url).toBe("https://auth.example/oauth/device/code");
    expect(requests[0].body.get("scope")).toBe(
      "openid profile email offline_access",
    );
    // An audience the tenant does not define fails the login outright, so none is sent
    // unless one is configured.
    expect(requests[0].body.has("audience")).toBe(false);
    expect(requests[1].body.get("audience")).toBe("https://api.example");
  });

  it("reports a refusal rather than returning a half-made code", async () => {
    auth0([403, { error: "unauthorized_client" }]);

    await expect(
      requestDeviceCode({ domain: "auth.example", clientId: "client" }),
    ).rejects.toThrow(/403/);
  });
});

describe("pollForDeviceToken", () => {
  it("keeps polling while the user has not confirmed, then returns the tokens", async () => {
    const requests = auth0(
      [403, { error: "authorization_pending" }],
      [403, { error: "authorization_pending" }],
      [200, TOKENS],
    );

    const result = pollForDeviceToken(POLL);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toMatchObject({ access_token: "access-1" });
    expect(requests).toHaveLength(3);
    expect(requests[0].body.get("device_code")).toBe("SECRET");
    expect(requests[0].body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });

  it("backs off by five seconds when told to slow down", async () => {
    const requests = auth0([429, { error: "slow_down" }], [200, TOKENS]);

    const result = pollForDeviceToken(POLL);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requests).toHaveLength(1);
    // The next poll is 10s later, not 5s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toMatchObject({ access_token: "access-1" });
    expect(requests).toHaveLength(2);
  });

  it("stops with the reason when the user refuses", async () => {
    auth0([
      403,
      { error: "access_denied", error_description: "User cancelled" },
    ]);

    const result = pollForDeviceToken(POLL);
    const settled = expect(result).rejects.toThrow("User cancelled");
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
  });

  it("stops polling the moment it is cancelled", async () => {
    const requests = auth0([403, { error: "authorization_pending" }]);
    const cancellation = new AbortController();

    const result = pollForDeviceToken({ ...POLL, signal: cancellation.signal });
    const settled = expect(result).rejects.toThrow("Login cancelled");
    await vi.advanceTimersByTimeAsync(5_000);
    cancellation.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;

    // One poll went out before the cancel; none after it.
    expect(requests).toHaveLength(1);
  });

  it("gives up when the code lapses unconfirmed", async () => {
    auth0(
      ...Array.from({ length: 5 }, (): [number, unknown] => [
        403,
        { error: "authorization_pending" },
      ]),
    );

    const result = pollForDeviceToken({ ...POLL, expiresInSeconds: 12 });
    const settled = expect(result).rejects.toThrow(/expired/i);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
  });
});

describe("refreshAccessToken", () => {
  it("trades the refresh token for a new access token", async () => {
    const requests = auth0([200, { ...TOKENS, access_token: "access-2" }]);

    const result = await refreshAccessToken({
      domain: "auth.example",
      clientId: "client",
      refreshToken: "refresh-1",
    });

    expect(result.access_token).toBe("access-2");
    expect(requests[0].body.get("grant_type")).toBe("refresh_token");
    expect(requests[0].body.get("refresh_token")).toBe("refresh-1");
  });

  it("throws when the refresh token is no longer good", async () => {
    auth0([403, { error: "invalid_grant" }]);

    await expect(
      refreshAccessToken({
        domain: "auth.example",
        clientId: "client",
        refreshToken: "revoked",
      }),
    ).rejects.toThrow(/403/);
  });
});
