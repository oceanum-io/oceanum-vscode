// Copyright Oceanum Ltd. Apache 2.0

export const OCEANUM_AI_BACKEND_URL = "https://ai.oceanum.io";
export const DATAMESH_UI_URL = "https://ui.datamesh.oceanum.io";

// There is deliberately no Auth0 configuration here. The extension
// authenticates with the Datamesh token only: the AI sidebar sends it as
// X-Datamesh-Token, and the Datamesh UI accepts it as `Token <value>` in the
// same header slot an Auth0 bearer would have used. The device-login flow was
// removed in 0.4.0 because it was a second credential for the same access.

/**
 * Safety net on observe requests per prompt. The server's EXECUTE_MAX_ROUNDS
 * is what actually caps the chain (at its cap it answers without code, which
 * ends the loop); this only stops a client talking to a server that keeps
 * sending code, and is checked after each round so the server's explanation
 * turn is always requested. Same value and rationale as oceanumlab.
 */
export const MAX_OBSERVE_ROUNDS = 8;
