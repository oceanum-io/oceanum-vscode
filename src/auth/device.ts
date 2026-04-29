// Copyright Oceanum Ltd. Apache 2.0
// OAuth 2.0 Device Authorization Grant (RFC 8628) for Auth0.

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export async function requestDeviceCode(params: {
  domain: string;
  clientId: string;
  audience?: string;
  scope?: string;
}): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    scope: params.scope ?? "openid profile email offline_access",
  });
  if (params.audience) body.set("audience", params.audience);

  const response = await fetch(`https://${params.domain}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device code request failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<DeviceCodeResponse>;
}

interface PollOptions {
  domain: string;
  clientId: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  signal?: AbortSignal;
}

export async function pollForDeviceToken(
  opts: PollOptions,
): Promise<DeviceTokenResponse> {
  const deadline = Date.now() + opts.expiresInSeconds * 1000;
  let intervalMs = opts.intervalSeconds * 1000;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("Login cancelled");
    await sleep(intervalMs, opts.signal);

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: opts.deviceCode,
      client_id: opts.clientId,
    });
    const response = await fetch(`https://${opts.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await response.json()) as
      | DeviceTokenResponse
      | { error: string; error_description?: string };

    if (response.ok && "access_token" in data) {
      return data;
    }

    const error = "error" in data ? data.error : `http_${response.status}`;
    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (error === "expired_token" || error === "access_denied") {
      throw new Error(
        "error_description" in data && data.error_description
          ? data.error_description
          : error,
      );
    }
    throw new Error(`Token poll failed: ${error}`);
  }
  throw new Error("Device code expired before authorization completed");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
