// Copyright Oceanum Ltd. Apache 2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_DOMAIN } from "../constants";

/**
 * Auth0 configuration is deployment identity, not user preference.
 *
 * `oceanum.auth0Domain`, `oceanum.auth0ClientId` and `oceanum.auth0Audience`
 * were user settings until 0.4.0. A wrong value there does not degrade the
 * extension: it mints a token no Oceanum service will accept, and the failure
 * surfaces as a broken login rather than as bad configuration. These pin that
 * the knobs are gone and that the values the code uses are real.
 */
describe("Auth0 configuration", () => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
  ) as {
    contributes: { configuration: { properties: Record<string, unknown> } };
  };

  it("exposes no auth0 setting to the user", () => {
    const settings = Object.keys(
      manifest.contributes.configuration.properties,
    ).filter((key) => /auth0/i.test(key));

    expect(settings).toEqual([]);
  });

  it("carries a usable tenant and application in code", () => {
    expect(AUTH0_DOMAIN).toMatch(
      /^[a-z0-9.-]+\.auth0\.com$|^auth\.oceanum\.io$/,
    );
    expect(AUTH0_CLIENT_ID).not.toBe("");
  });

  it("asks for no audience, or for one shaped like an API identifier", () => {
    // Empty is the current state: requesting an audience the tenant does not
    // define fails the device login outright, so it stays empty until that API
    // exists. Deliberately not pinned to "" -- src/constants.ts plans for it
    // being set, and a test that fails on the intended change is a trap. What
    // must hold either way is that it is never a stray string: Auth0 matches
    // the API identifier exactly, so a missing scheme or a trailing slash is
    // the failure this catches.
    expect(AUTH0_AUDIENCE).toMatch(/^$|^https:\/\/[^\s/]+(\/[^\s]*[^\s/])?$/);
  });
});
