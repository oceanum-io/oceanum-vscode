// Copyright Oceanum Ltd. Apache 2.0
// The signed-in Oceanum.io session: where its tokens live, and who it is.
import * as vscode from "vscode";
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from "../constants";
import { refreshAccessToken, type DeviceTokenResponse } from "./device";

// Refresh slightly before the real expiry to avoid races against in-flight calls.
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

const ACCESS_TOKEN = "oceanum.accessToken";
const REFRESH_TOKEN = "oceanum.refreshToken";
const EXPIRY = "oceanum.accessTokenExpiry";
// Not a credential, but it identifies a person, so it is kept with them rather than in
// globalState, which is plain JSON on disk and synced by Settings Sync.
const EMAIL = "oceanum.userEmail";

/**
 * The email claim of an ID token received directly from Auth0's token endpoint.
 *
 * Decoded without verifying the signature, which OpenID Connect allows for exactly this
 * case (Core 3.1.3.7): the token came straight from the issuer over TLS, not through a
 * browser, so the TLS server check is what authenticates it.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const email = claims.email ?? claims["https://oceanum.io/email"];
    return typeof email === "string" && email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

export async function storeTokens(
  context: vscode.ExtensionContext,
  token: DeviceTokenResponse,
): Promise<void> {
  await context.secrets.store(ACCESS_TOKEN, token.access_token);
  if (token.refresh_token) {
    await context.secrets.store(REFRESH_TOKEN, token.refresh_token);
  }
  await context.secrets.store(
    EXPIRY,
    String(Date.now() + token.expires_in * 1000),
  );
  // A refresh may come back without an ID token; the identity has not changed, so keep it.
  const email = emailFromIdToken(token.id_token);
  if (email) {
    await context.secrets.store(EMAIL, email);
  }
}

export async function clearTokens(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(ACCESS_TOKEN);
  await context.secrets.delete(REFRESH_TOKEN);
  await context.secrets.delete(EXPIRY);
  await context.secrets.delete(EMAIL);
}

async function isAccessTokenExpired(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const raw = await context.secrets.get(EXPIRY);
  const expiry = Number(raw);
  // No/!finite expiry → token predates expiry tracking; don't trust it.
  if (!Number.isFinite(expiry)) return true;
  return Date.now() >= expiry - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Returns a usable access token, refreshing a stale one when possible.
 * Returns "" if there is no token, or it expired and could not be refreshed
 * (stale tokens are cleared so the caller can fall back to device login).
 */
export async function getValidAccessToken(
  context: vscode.ExtensionContext,
): Promise<string> {
  const accessToken = (await context.secrets.get(ACCESS_TOKEN)) ?? "";
  if (!accessToken) return "";
  if (!(await isAccessTokenExpired(context))) return accessToken;

  const refreshToken = await context.secrets.get(REFRESH_TOKEN);
  if (!refreshToken) {
    await clearTokens(context);
    return "";
  }

  try {
    const refreshed = await refreshAccessToken({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      refreshToken,
    });
    await storeTokens(context, refreshed);
    return refreshed.access_token;
  } catch {
    // A revoked or expired refresh token. The session is over: drop what is left of it so
    // the caller falls back to signing in again.
    await clearTokens(context);
    return "";
  }
}

/**
 * Who is signed in, or null. Null also for a session from before this was recorded: that
 * user still has working tokens but no known identity, and is asked to sign in again
 * before anything is saved under a name.
 */
export async function signedInEmail(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  if (!(await getValidAccessToken(context))) return null;
  return (await context.secrets.get(EMAIL)) ?? null;
}
