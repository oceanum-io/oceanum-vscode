// Copyright Oceanum Ltd. Apache 2.0

export const OCEANUM_AI_BACKEND_URL = "https://ai.oceanum.io";
export const DATAMESH_UI_URL = "https://ui.datamesh.oceanum.io";

// Auth0 Native application for the VS Code extension.
// Uses Device Authorization Grant (RFC 8628) — no callback URL required.
//
// Not user settings. Which tenant issues the token, which application asks for
// it, and which API it is minted for are properties of the Oceanum deployment,
// not preferences: a wrong value does not degrade the extension, it produces a
// token no Oceanum service will accept, with a failure that looks like a login
// bug. They were `oceanum.auth0Domain`, `oceanum.auth0ClientId` and
// `oceanum.auth0Audience` until 0.4.0; the first two already fell back to the
// values below, so only a user who had overridden them sees any change.
export const AUTH0_DOMAIN = "auth.oceanum.io";
export const AUTH0_CLIENT_ID = "ah2hkmuxnFaKwoKoTyLxJPA9z91WBjlt";

// The API identifier the access token is minted for. Empty means the login
// asks for no audience and Auth0 issues its tenant default, which is what has
// always happened here -- the setting existed but had no value behind it.
//
// Leave it empty until the matching Auth0 API exists in the tenant: requesting
// an audience the tenant does not define fails the device login outright,
// rather than degrading. Setting it is what will let these tokens reach
// services that check the claim (oceanum-ai forwards them to the hosted
// Datamesh MCP, which verifies its own audience).
export const AUTH0_AUDIENCE = "";

/**
 * Safety net on observe requests per prompt. The server's EXECUTE_MAX_ROUNDS
 * is what actually caps the chain (at its cap it answers without code, which
 * ends the loop); this only stops a client talking to a server that keeps
 * sending code, and is checked after each round so the server's explanation
 * turn is always requested. Same value and rationale as oceanumlab.
 */
export const MAX_OBSERVE_ROUNDS = 8;
