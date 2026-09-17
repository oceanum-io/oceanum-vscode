// Copyright Oceanum Ltd. Apache 2.0
// Pinned before anything builds a Date. CI runs in UTC, where reading a zoneless timestamp
// as local time and reading it as UTC give the same answer, so without this the first test
// below would pass whether or not the code was right.
process.env.TZ = "Pacific/Auckland";

import { describe, expect, it } from "vitest";
import { formatModified } from "./notebooks";

const NOW = new Date("2026-09-18T00:00:00Z");

describe("formatModified", () => {
  it("reads the spec store's zoneless timestamps as UTC", () => {
    // 23:30 UTC on the 1st is already the 2nd in Auckland (UTC+12). Read as local time it
    // would stay the 1st.
    expect(formatModified("2026-03-01T23:30:00", NOW)).toMatch(/\b2\b/);
    expect(formatModified("2026-03-01T23:30:00", NOW)).not.toMatch(/\b1\b/);
  });

  it("leaves a timestamp that names its zone alone", () => {
    expect(formatModified("2026-03-01T23:30:00Z", NOW)).toBe(
      formatModified("2026-03-01T23:30:00", NOW),
    );
    expect(formatModified("2026-03-02T11:30:00+12:00", NOW)).toBe(
      formatModified("2026-03-01T23:30:00", NOW),
    );
  });

  it("names the year only when it is not this one", () => {
    expect(formatModified("2026-03-01T00:00:00", NOW)).not.toContain("2026");
    expect(formatModified("2024-03-01T00:00:00", NOW)).toContain("2024");
  });

  it("shows nothing for a value that is not a time", () => {
    expect(formatModified("not a time", NOW)).toBe("");
  });
});
