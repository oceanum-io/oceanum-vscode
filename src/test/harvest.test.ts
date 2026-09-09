// Copyright Oceanum Ltd. Apache 2.0
import { describe, it, expect } from "vitest";
import {
  harvestOutputs,
  stripAnsi,
  STDOUT_MIME,
  STDERR_MIME,
  ERROR_MIME,
} from "../ai/harvest";

const enc = new TextEncoder();
const item = (mime: string, text: string) => ({ mime, data: enc.encode(text) });

describe("harvestOutputs", () => {
  it("concatenates stdout in order and reports ok", () => {
    const out = harvestOutputs([
      item(STDOUT_MIME, "rows 240\n"),
      item(STDOUT_MIME, "max 2.5\n"),
    ]);
    expect(out).toEqual({
      status: "ok",
      stdout: "rows 240\nmax 2.5\n",
      error: null,
    });
  });

  it("turns VS Code's JSON error item into an error run with the stack, ANSI stripped", () => {
    const out = harvestOutputs([
      item(STDOUT_MIME, "before\n"),
      item(
        ERROR_MIME,
        JSON.stringify({
          name: "NameError",
          message: "name 'ds' is not defined",
          stack:
            "\u001b[0;31mNameError\u001b[0m Traceback\nname 'ds' is not defined",
        }),
      ),
    ]);
    expect(out.status).toBe("error");
    expect(out.stdout).toBe("before\n");
    expect(out.error).toContain("NameError: name 'ds' is not defined");
    expect(out.error).not.toContain("\u001b[");
    expect(out.error).toContain("NameError Traceback");
  });

  it("folds stderr into the error text when the run failed", () => {
    const out = harvestOutputs([
      item(STDERR_MIME, "FutureWarning: something\n"),
      item(ERROR_MIME, JSON.stringify({ name: "ValueError", message: "bad" })),
    ]);
    expect(out.status).toBe("error");
    expect(out.error).toContain("ValueError: bad");
    expect(out.error).toContain("FutureWarning");
  });

  it("does not send rendered outputs like DataFrame reprs", () => {
    const out = harvestOutputs([item("text/plain", "huge dataframe repr")]);
    expect(out).toEqual({ status: "ok", stdout: "", error: null });
  });

  it("is ok with no outputs at all", () => {
    expect(harvestOutputs([])).toEqual({
      status: "ok",
      stdout: "",
      error: null,
    });
  });
});

describe("stripAnsi", () => {
  it("removes colour and cursor codes", () => {
    expect(stripAnsi("\u001b[1;31mred\u001b[0m plain")).toBe("red plain");
  });
});
