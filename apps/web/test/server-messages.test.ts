import { describe, expect, it } from "vitest";
// @ts-expect-error a plain script, shared with the command line
import { serverMessages } from "../scripts/find-server-messages.mjs";
import { hasHindi } from "../src/i18n";

interface Message {
  file: string;
  line: number;
  kind: string;
  text: string;
}

// Messages that are not for the screens: for the person who runs the server, in its terminal.
// plus the pieces of messages that are put together from parts, each part of which has its own
// entry (the scan can only see the joined text, with a stand-in for each gap).
const NOT_SHOWN: string[] = [
  "x rejected the requestx",
  "Can't reach x at x.x",
  "Connected to x. x modelx available.",
  "{host}",
  "{target}",
  "{newName}",
  // the story importer, run from the command line
  "x already holds a world; choose a new folder",
  // the lore importer, run from the command line
  '"x" cannot be a world name in the database (letters, digits, hyphens).',
];

describe("what the server says to people", () => {
  it("has Hindi for every message, refusal and announcement", () => {
    const missing = (serverMessages() as Message[])
      .filter((m) => !NOT_SHOWN.includes(m.text))
      .filter((m) => !hasHindi(m.text))
      .map((m) => `${m.file}:${m.line} ${m.kind} ${JSON.stringify(m.text)}`);
    expect(missing).toEqual([]);
  });
});
