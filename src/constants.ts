// Copyright Oceanum Ltd. Apache 2.0

export const OCEANUM_AI_BACKEND_URL = "https://ai.oceanum.io";
export const DATAMESH_UI_URL = "https://ui.datamesh.oceanum.io";

// Auth0 Native application for the VS Code extension.
// Uses Device Authorization Grant (RFC 8628) — no callback URL required.
export const AUTH0_DOMAIN = "auth.oceanum.io";
export const AUTH0_CLIENT_ID = "ah2hkmuxnFaKwoKoTyLxJPA9z91WBjlt";

/**
 * Safety net on observe requests per prompt. The server's EXECUTE_MAX_ROUNDS
 * is what actually caps the chain (at its cap it answers without code, which
 * ends the loop); this only stops a client talking to a server that keeps
 * sending code, and is checked after each round so the server's explanation
 * turn is always requested. Same value and rationale as oceanumlab.
 */
export const MAX_OBSERVE_ROUNDS = 8;
