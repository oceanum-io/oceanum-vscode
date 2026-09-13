// Copyright Oceanum Ltd. Apache 2.0
import type { Progress } from "./types";

/**
 * What each phase is, in the user's terms (OCE-175). The same wording as
 * oceanumlab, so the two notebook clients say the same thing.
 *
 * An unlisted phase or tool falls back to something generic rather than
 * showing its internal name: a new server-side tool should read as progress,
 * not as a leak of what the agent is made of. And no phase at all reads as
 * "Thinking…", which is what the panel said before there was anything better
 * to say -- so a backend that does not stream, or a proxy that buffered the
 * stream away, degrades to exactly the old behaviour rather than to a blank.
 */
const TOOL_LABELS: Record<string, string> = {
  search_catalog: "Searching the catalogue…",
  get_datasource_info: "Reading dataset details…",
  save_memory: "Saving a note…",
};

const PHASE_LABELS: Record<string, string> = {
  generating: "Thinking…",
  interpreting: "Reading the result…",
  // Reported by the extension, not the server: these two are the notebook's
  // turn. Everything else here names something the agent is doing, and saying
  // so while a cell runs would be actively false rather than merely vague.
  running: "Running the code…",
  placing: "Adding the code to the notebook…",
};

export function describeProgress(progress: Progress | null): string {
  if (!progress) {
    return "Thinking…";
  }
  if (progress.phase === "tool") {
    return labelFor(TOOL_LABELS, progress.tool) ?? "Looking something up…";
  }
  return labelFor(PHASE_LABELS, progress.phase) ?? "Working…";
}

/**
 * The label `labels` itself gives `name`, if any. Only its own entries: the
 * name comes off the stream -- a tool name is whatever the model called -- and
 * `__proto__` or `toString` must not reach into Object.prototype. That hands
 * React an object or a function to render, and an object blanks the sidebar.
 */
function labelFor(
  labels: Record<string, string>,
  name: string | undefined,
): string | undefined {
  return name !== undefined &&
    Object.prototype.hasOwnProperty.call(labels, name)
    ? labels[name]
    : undefined;
}
