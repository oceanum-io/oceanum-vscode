// Copyright Oceanum Ltd. Apache 2.0
import type { ObservedRun } from "../types";

/** The subset of vscode.NotebookCellOutputItem this needs, so tests need no host. */
export interface OutputItem {
  mime: string;
  data: Uint8Array;
}

export const STDOUT_MIME = "application/vnd.code.notebook.stdout";
export const STDERR_MIME = "application/vnd.code.notebook.stderr";
export const ERROR_MIME = "application/vnd.code.notebook.error";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Kernel tracebacks are coloured for a terminal; the model does not need that. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

const decoder = new TextDecoder();

/**
 * Reduce a cell's output items to what the observation prompt needs.
 *
 * stdout items are concatenated in order. An error item makes the run an
 * error; VS Code stores it as JSON `{name, message, stack}`, and the stack is
 * the traceback. stderr is folded in after an error, because warnings there
 * are often the useful part of a failure. Rendered outputs (text/plain,
 * images, HTML) are deliberately NOT sent: a DataFrame repr is kilobytes of
 * dataset-derived text, and the printed summary the code chose to make is
 * what the agent should reason from.
 */
export function harvestOutputs(
  items: readonly OutputItem[],
): Pick<ObservedRun, "status" | "stdout" | "error"> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let error: string | null = null;

  for (const item of items) {
    const text = decoder.decode(item.data);
    if (item.mime === STDOUT_MIME) {
      stdout.push(text);
    } else if (item.mime === STDERR_MIME) {
      stderr.push(text);
    } else if (item.mime === ERROR_MIME) {
      error = describeError(text);
    }
  }

  if (error !== null && stderr.length > 0) {
    error = `${error}\n${stripAnsi(stderr.join(""))}`.trim();
  }

  return {
    status: error === null ? "ok" : "error",
    stdout: stripAnsi(stdout.join("")),
    error,
  };
}

function describeError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      message?: string;
      stack?: string;
    };
    const head = [parsed.name, parsed.message].filter(Boolean).join(": ");
    return stripAnsi([head, parsed.stack ?? ""].join("\n")).trim();
  } catch {
    return stripAnsi(raw).trim();
  }
}
