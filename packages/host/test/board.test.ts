import type { Actor } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import {
  ADULT_CONFIRMATION_MESSAGE,
  Board,
  describeModeration,
  FLAVOR_STYLES,
  HostError,
  isProduction,
} from "../src";

const host: Actor = { id: "Dana", role: "host" };
const player: Actor = { id: "Sam", role: "player" };

let n = 0;
const ports = { newId: () => `id${++n}`, now: () => "2026-10-25T10:00:00Z" };

/** Dana runs the table; Sam and Robin have joined and opted to play; Kit is only watching. */
function table(requireAdultConfirmation = false) {
  const board = new Board({ host: "Dana", ports, requireAdultConfirmation });
  for (const nick of ["Sam", "Robin", "Kit"]) board.join(nick, { confirmedAdult: true });
  board.play("Sam");
  board.play("Robin");
  return board;
}

describe("joining", () => {
  it("seats the host, and everyone else comes in as a spectator who can opt to play", () => {
    const board = new Board({ host: "Dana", ports, requireAdultConfirmation: false });
    expect(board.view().participants).toEqual([{ nick: "Dana", seat: "host", muted: false }]);
    expect(board.join("Sam")).toEqual({ nick: "Sam", seat: "spectator", muted: false });
    expect(board.play("Sam").seat).toBe("player");
    expect(board.watch("Sam").seat).toBe("spectator");
  });

  it("checks nicknames, ignoring case for uniqueness", () => {
    const board = new Board({ host: "Dana", ports, requireAdultConfirmation: false });
    for (const bad of ["", "two words", "x".repeat(25), "<script>", "a\nb"]) {
      expect(() => board.join(bad)).toThrow(/Pick a nickname/);
    }
    board.join("Sam");
    expect(() => board.join("sam")).toThrow('The nickname "sam" is already taken at this table.');
    expect(() => board.join("DANA")).toThrow(/already taken/);
    expect(board.join("[Sam]|2").nick).toBe("[Sam]|2");
  });

  it("lets people leave, but not the host", () => {
    const board = table();
    board.setDraft("Sam", "do", "I knock.");
    board.leave("Sam");
    expect(board.view().participants.map((p) => p.nick)).toEqual(["Dana", "Robin", "Kit"]);
    expect(board.view().drafts).toEqual([]);
    expect(() => board.leave("Dana")).toThrow(HostError);
    expect(() => board.leave("Nobody")).toThrow(/has not joined/);
  });
});

describe("age confirmation (production only)", () => {
  it("is asked of joiners when required, and recorded as a plain attestation", () => {
    const board = new Board({ host: "Dana", ports, requireAdultConfirmation: true });
    expect(board.requiresAdultConfirmation).toBe(true);
    expect(() => board.join("Sam")).toThrow(ADULT_CONFIRMATION_MESSAGE);
    expect(() => board.join("Sam", { confirmedAdult: false })).toThrow(ADULT_CONFIRMATION_MESSAGE);
    try {
      board.join("Sam");
    } catch (e) {
      expect((e as HostError).code).toBe("age_unconfirmed");
    }
    expect(board.view().participants).toHaveLength(1); // nobody was seated
    expect(board.join("Sam", { confirmedAdult: true }).nick).toBe("Sam");
  });

  it("is not asked when not required, whatever the joiner sends", () => {
    const board = new Board({ host: "Dana", ports, requireAdultConfirmation: false });
    expect(board.requiresAdultConfirmation).toBe(false);
    expect(board.join("Sam").seat).toBe("spectator");
  });

  it("follows the environment by default: production only", () => {
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    for (const env of [
      {},
      { NODE_ENV: "development" },
      { NODE_ENV: "test" },
      { NODE_ENV: "Production " },
    ]) {
      expect(isProduction(env)).toBe(false);
    }
    // tests run with NODE_ENV=test, so the default board does not ask
    expect(new Board({ host: "Dana", ports }).requiresAdultConfirmation).toBe(false);
  });
});

describe("writing a turn on the shared board", () => {
  it("gives every player their own lines, which everyone at the table can see", () => {
    const board = table();
    board.setDraft("Sam", "do", "I knock on the door.");
    board.setDraft("Robin", "say", "Let me do the talking.");
    const view = board.view();
    expect(view.drafts.map((d) => [d.nick, d.mode, d.text, d.ready])).toEqual([
      ["Sam", "do", "I knock on the door.", false],
      ["Robin", "say", "Let me do the talking.", false],
    ]);
    // the same snapshot whoever asks: there is one table
    expect(board.view()).toEqual(view);
  });

  it("only lets players write, and only their own turn", () => {
    const board = table();
    expect(() => board.setDraft("Kit", "do", "I peek.")).toThrow(
      "Opt in to play before writing a turn.",
    );
    expect(() => board.setDraft("Ghost", "do", "x")).toThrow(/has not joined/);
    expect(() => board.setDraft("Sam", "do", "x".repeat(2001))).toThrow(/under 2000/);
    board.setDraft("Dana", "story", "The host may write too."); // the host sits at the table as a player
    expect(board.view().drafts[0]?.nick).toBe("Dana");
  });

  it("clears a draft when it is emptied, and clears 'ready' whenever it changes", () => {
    const board = table();
    board.setDraft("Sam", "do", "I knock.");
    board.ready("Sam");
    expect(board.view().drafts[0]?.ready).toBe(true);
    board.setDraft("Sam", "do", "I knock twice.");
    expect(board.view().drafts[0]?.ready).toBe(false);
    board.setDraft("Sam", "do", "   ");
    expect(board.view().drafts).toEqual([]);
    expect(() => board.ready("Sam")).toThrow("Write your turn before marking it ready.");
  });
});

describe("objecting and discussing before anything is submitted", () => {
  it("lets players remark and object, visibly to everyone", () => {
    const board = table();
    board.setDraft("Sam", "do", "I burn the bridge.");
    board.remark("Robin", "Are we sure about this?");
    const objection = board.object("Robin", "Sam", "Marrow is still on that bridge.");
    expect(objection).toMatchObject({ kind: "objection", by: "Robin", about: "Sam" });

    const view = board.view();
    expect(view.remarks.map((r) => [r.kind, r.by, r.text])).toEqual([
      ["remark", "Robin", "Are we sure about this?"],
      ["objection", "Robin", "Marrow is still on that bridge."],
    ]);
    expect(view.drafts[0]?.objections).toBe(1);
  });

  it("marks an objection answered when the drafter changes their turn", () => {
    const board = table();
    board.setDraft("Sam", "do", "I burn the bridge.");
    board.object("Robin", "Sam", "Marrow is still on that bridge.");
    board.setDraft("Sam", "do", "I wait for Marrow to cross, then burn the bridge.");
    const view = board.view();
    expect(view.drafts[0]?.objections).toBe(0);
    expect(view.remarks.find((r) => r.kind === "objection")?.answered).toBe(true);
  });

  it("lets an author take back their own remark, and nobody else's", () => {
    const board = table();
    const remark = board.remark("Robin", "Hmm.");
    expect(() => board.withdraw("Sam", remark.id)).toThrow(
      "You can only take back your own remarks.",
    );
    board.withdraw("Robin", remark.id);
    expect(board.view().remarks).toEqual([]);
  });

  it("keeps spectators out of the talking, and objections tied to a written turn", () => {
    const board = table();
    expect(() => board.remark("Kit", "I have thoughts.")).toThrow(/Opt in to play/);
    expect(() => board.object("Robin", "Sam", "x")).toThrow(
      "Sam has not written anything yet to object to.",
    );
    board.setDraft("Sam", "do", "go");
    expect(() => board.object("Sam", "Sam", "x")).toThrow("Object to someone else's turn.");
    expect(() => board.remark("Robin", "   ")).toThrow("Write something first.");
  });
});

describe("closing a round", () => {
  it("closes when every player who wrote something is ready, ignoring players who wrote nothing", () => {
    const board = table();
    expect(board.closed).toBe(false); // nobody has written anything
    board.setDraft("Sam", "do", "I open the door.");
    board.setDraft("Robin", "say", "Hello?");
    board.ready("Robin");
    expect(board.closed).toBe(false); // Sam is not ready
    expect(board.takeRound()).toBeUndefined();
    board.ready("Sam");
    expect(board.closed).toBe(true); // Dana wrote nothing and does not hold the round up
  });

  it("hands the lines over in the order players became ready, then clears the table", () => {
    const board = table();
    board.setDraft("Sam", "do", "I open the door.");
    board.setDraft("Robin", "say", "Hello?");
    board.ready("Robin");
    board.ready("Sam");
    board.remark("Robin", "ok");
    expect(board.takeRound()).toEqual([
      { by: "Robin", mode: "say", text: "Hello?" },
      { by: "Sam", mode: "do", text: "I open the door." },
    ]);
    const after = board.view();
    expect(after.drafts).toEqual([]);
    expect(after.remarks).toEqual([]);
    expect(after.closed).toBe(false);
    expect(board.takeRound()).toBeUndefined();
  });

  it("waits while the story is writing a reply, but lets players prepare their next turn", () => {
    const board = table();
    board.setBusy(true);
    board.setDraft("Sam", "do", "Next, I run.");
    board.ready("Sam");
    expect(board.closed).toBe(false);
    expect(board.takeRound()).toBeUndefined();
    expect(board.view().busy).toBe(true);
    board.setBusy(false);
    expect(board.takeRound()).toEqual([{ by: "Sam", mode: "do", text: "Next, I run." }]);
  });

  it("takes a single player's turn as soon as they are ready (solo play)", () => {
    const board = new Board({ host: "Dana", ports, requireAdultConfirmation: false });
    board.setDraft("Dana", "do", "I look around.");
    board.ready("Dana");
    expect(board.takeRound()).toEqual([{ by: "Dana", mode: "do", text: "I look around." }]);
  });

  it("lets only the host close the round early, taking every written turn", () => {
    const board = table();
    board.setDraft("Sam", "do", "I go left.");
    board.setDraft("Robin", "do", "I go right.");
    board.ready("Sam");
    expect(() => board.closeRound(player)).toThrow("Only the host can wield that power.");
    expect(board.view().drafts).toHaveLength(2); // refused, nothing taken
    expect(board.closeRound(host)).toEqual([
      { by: "Sam", mode: "do", text: "I go left." },
      { by: "Robin", mode: "do", text: "I go right." },
    ]);
    expect(board.closeRound(host)).toBeUndefined(); // nothing left to take
  });
});

describe("moderation, told in the story's voice", () => {
  it("lets only the host use these powers", () => {
    const board = table();
    for (const act of [
      () => board.kick(player, "Robin"),
      () => board.mute(player, "Robin"),
      () => board.unmute(player, "Robin"),
      () => board.rename(player, "Robin", "Bob"),
    ]) {
      expect(act).toThrow("Only the host can wield that power.");
    }
    expect(board.view().participants.find((p) => p.nick === "Robin")?.muted).toBe(false);
  });

  it("mutes with a strip of tape, a spell, a gauntlet or a muzzle, and the effect is plain state", () => {
    const board = table();
    board.setDraft("Robin", "do", "I grab the lamp.");
    board.ready("Robin");
    const notice = board.mute(host, "Robin", "tape");
    expect(notice).toMatchObject({ kind: "notice", by: "Dana" });
    expect(notice.text).toContain("Robin");
    expect(notice.text).toMatch(/tape/i);

    expect(board.view().participants.find((p) => p.nick === "Robin")?.muted).toBe(true);
    expect(board.view().notices.map((x) => x.text)).toEqual([notice.text]);
    // hushed: cannot write, remark or object; the plain reason is clear
    expect(() => board.setDraft("Robin", "do", "x")).toThrow(
      "Your voice is hushed for now: you can read, but not write.",
    );
    expect(() => board.remark("Robin", "x")).toThrow(/hushed/);
    // their draft stays visible but is not submitted, and no longer holds the round up
    board.setDraft("Sam", "do", "I light the lamp.");
    board.ready("Sam");
    expect(board.takeRound()).toEqual([{ by: "Sam", mode: "do", text: "I light the lamp." }]);
  });

  it("unmutes in the same voice", () => {
    const board = table();
    board.mute(host, "Robin", "spell");
    const notice = board.unmute(host, "Robin", "spell");
    expect(notice.text).toContain("Robin");
    expect(board.view().participants.find((p) => p.nick === "Robin")?.muted).toBe(false);
    board.setDraft("Robin", "do", "I may speak again."); // no error
  });

  it("kicks someone out of the room, who may come back by joining again", () => {
    const board = table();
    board.setDraft("Robin", "do", "x");
    const notice = board.kick(host, "Robin", "weapon");
    expect(notice.text).toMatch(/Robin/);
    expect(board.view().participants.map((p) => p.nick)).not.toContain("Robin");
    expect(board.view().drafts).toEqual([]);
    expect(board.join("Robin").seat).toBe("spectator");
  });

  it("renames someone, keeping their draft and remarks", () => {
    const board = table();
    board.setDraft("Robin", "do", "I wave.");
    board.remark("Robin", "Hi.");
    const notice = board.rename(host, "Robin", "Wren", "spell");
    expect(notice.text).toContain("Wren");
    const view = board.view();
    expect(view.participants.map((p) => p.nick)).toContain("Wren");
    expect(view.drafts[0]?.nick).toBe("Wren");
    expect(view.remarks[0]?.by).toBe("Wren");
    expect(() => board.rename(host, "Wren", "Sam")).toThrow(/already taken/);
    expect(() => board.rename(host, "Wren", "two words")).toThrow(/Pick a nickname/);
  });

  it("never turns these powers on the host", () => {
    const board = table();
    for (const act of [
      () => board.kick(host, "Dana"),
      () => board.mute(host, "Dana"),
      () => board.rename(host, "Dana", "Boss"),
    ]) {
      expect(act).toThrow("That power cannot be used on the host.");
    }
  });

  it("rotates through the styles when the host does not choose, and is deterministic", () => {
    const texts = (b: Board) => {
      const out: string[] = [];
      for (let i = 0; i < 5; i++) {
        out.push(b.mute(host, "Robin").text);
        b.unmute(host, "Robin");
      }
      return out;
    };
    const first = texts(table());
    expect(first).toEqual(texts(table()));
    expect(new Set(first).size).toBeGreaterThan(3);
    const fixed = new Board({
      host: "Dana",
      ports,
      requireAdultConfirmation: false,
      defaultStyle: "tape",
    });
    fixed.join("Robin");
    expect(fixed.mute(host, "Robin").text).toMatch(/tape/i);
  });

  it("keeps at most the last fifty notices", () => {
    const board = table();
    for (let i = 0; i < 60; i++) board.mute(host, "Robin");
    expect(board.view().notices).toHaveLength(50);
  });
});

describe("describeModeration", () => {
  it("has wording for every action in every style, with no placeholders left over", () => {
    for (const action of ["kick", "mute", "unmute", "rename"] as const) {
      for (const style of FLAVOR_STYLES) {
        for (const variant of [0, 1, 2]) {
          const text = describeModeration(
            action,
            style,
            { host: "Dana", target: "Robin", newName: "Wren" },
            variant,
          );
          expect(text).toContain("Robin");
          expect(text).not.toMatch(/[{}]/);
          if (action === "rename") expect(text).toContain("Wren");
        }
      }
    }
  });
});
