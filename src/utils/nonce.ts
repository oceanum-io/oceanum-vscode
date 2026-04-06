// Copyright Oceanum Ltd. Apache 2.0

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function getNonce(): string {
  return Array.from(
    { length: 32 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
}
