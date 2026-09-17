// Copyright Oceanum Ltd. Apache 2.0

/**
 * When a stored notebook was last modified, for the list.
 *
 * The spec store's timestamps are UTC but usually carry no zone designator, and a bare
 * ISO string is read as LOCAL time by `Date`. Without the `Z` every time would be off by
 * the viewer's UTC offset -- invisibly so in CI, which runs in UTC.
 */
export function formatModified(value: string, now: Date = new Date()): string {
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(zoned);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
