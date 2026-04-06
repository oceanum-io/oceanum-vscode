// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import { getNonce } from "../utils/nonce";

describe("getNonce", () => {
  it("returns a 32-character string", () => {
    expect(getNonce()).toHaveLength(32);
  });

  it("contains only alphanumeric characters", () => {
    expect(getNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("returns a different value each call", () => {
    expect(getNonce()).not.toBe(getNonce());
  });
});
