// Copyright Oceanum Ltd. Apache 2.0
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands";

/**
 * One credential, and it is the Datamesh token.
 *
 * The extension carried a second, redundant one until 0.4.0: an Auth0 device
 * login whose access token was handed to the embedded Datamesh UI. That UI
 * treats the two as alternatives for the same header
 * (`Bearer <jwt>` or `Token <datamesh token>`), and the AI sidebar never used
 * the Auth0 token at all, so it bought nothing and doubled what could leak or
 * expire. These pin that neither the settings nor the commands come back.
 */
describe("authentication surface", () => {
  const root = join(__dirname, "..", "..");
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as {
    contributes: {
      configuration: { properties: Record<string, unknown> };
      commands: { command: string }[];
    };
  };

  it("exposes no auth0 setting", () => {
    const settings = Object.keys(
      manifest.contributes.configuration.properties,
    ).filter((key) => /auth0/i.test(key));

    expect(settings).toEqual([]);
  });

  it("exposes no sign-in or sign-out command", () => {
    const commands = manifest.contributes.commands
      .map((entry) => entry.command)
      .filter((command) => /login|signOut|auth0/i.test(command));

    expect(commands).toEqual([]);
    expect(Object.keys(COMMANDS)).not.toContain("LOGIN");
    expect(Object.keys(COMMANDS)).not.toContain("SIGN_OUT");
  });

  it("keeps the Datamesh token as the way in", () => {
    // The removal must not have taken the remaining credential with it.
    expect(COMMANDS.SET_TOKEN).toBe("oceanum.setToken");
    expect(manifest.contributes.configuration.properties).toHaveProperty(
      "oceanum.datameshToken",
    );
    expect(
      manifest.contributes.commands.map((entry) => entry.command),
    ).toContain("oceanum.setToken");
  });

  it("ships no Auth0 client code", () => {
    // Any auth-ish directory, not just the one this removed: `src/auth0/`
    // would have slipped past an equality check on the old name.
    const authDirs = readdirSync(join(root, "src")).filter((entry) =>
      /auth/i.test(entry),
    );

    expect(authDirs).toEqual([]);
  });
});
