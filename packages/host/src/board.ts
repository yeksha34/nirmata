import type { Actor, PlayerMode } from "@nirmata/core";
import { requireCan } from "./access";
import { ADULT_CONFIRMATION_MESSAGE, isProduction } from "./age";
import {
  describeModeration,
  FLAVOR_STYLES,
  type FlavorStyle,
  type ModerationAction,
} from "./moderation";
import { HostError, type Ports } from "./types";

/**
 * The shared board (ADR-0013): where a turn is written before the story answers. Every player has
 * their own lines to write their turn in, everyone at the table can see what the others are
 * writing, and can object or discuss before anything is submitted. When every player who has
 * written something marks it ready (or the host closes the round), the lines are handed to the
 * story together and the board is cleared for the next round.
 *
 * The board is plain state with no timers and no network: a server wires it to connections and
 * calls `takeRound` when the story is idle. Joining is IRC-style (ADR-0011): a nickname, no
 * accounts.
 */
export type Seat = "host" | "player" | "spectator";

export interface RoundInput {
  by: string;
  mode: PlayerMode;
  text: string;
}

export interface BoardOptions {
  /** The nickname of whoever runs the story's server. Seated as host. */
  host: string;
  ports?: Ports | undefined;
  /**
   * Ask joiners to confirm they are adults. Defaults to on in production only (ADR-0014).
   */
  requireAdultConfirmation?: boolean | undefined;
  /** Moderation wording style when the host does not choose one; rotates when unset. */
  defaultStyle?: FlavorStyle | undefined;
}

export interface ParticipantView {
  nick: string;
  seat: Seat;
  muted: boolean;
}

export interface DraftView {
  nick: string;
  mode: PlayerMode;
  text: string;
  ready: boolean;
  /** Objections still standing against this draft (not withdrawn, not answered by an edit). */
  objections: number;
}

export interface RemarkView {
  id: string;
  kind: "remark" | "objection" | "notice";
  by: string;
  text: string;
  /** Objections only: whose turn is being objected to. */
  about?: string | undefined;
  /** Objections only: the drafter has since changed the turn. */
  answered?: boolean | undefined;
  t: string;
}

export interface BoardView {
  host: string;
  participants: ParticipantView[];
  drafts: DraftView[];
  remarks: RemarkView[];
  /** In-fiction moderation lines, kept across rounds (newest last, at most 50). */
  notices: RemarkView[];
  busy: boolean;
  /** True when every player who wrote something is ready and the story is idle. */
  closed: boolean;
}

interface Person {
  nick: string;
  seat: Seat;
  muted: boolean;
  adultConfirmedAt?: string | undefined;
}

interface Draft {
  nick: string;
  mode: PlayerMode;
  text: string;
  ready: boolean;
  /** Order of last edit, and of becoming ready; decides the order lines reach the story. */
  seq: number;
  readySeq?: number | undefined;
}

interface Remark extends RemarkView {}

const MAX_DRAFT = 2000;
const MAX_REMARK = 500;
const MAX_NOTICES = 50;
const NICK = /^[\p{L}\p{N}_\-[\]\\^{}|]{1,24}$/u;

const key = (nick: string) => nick.toLowerCase();

const defaultPorts: Ports = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

function fail(code: HostError["code"], message: string): never {
  throw new HostError(code, message);
}

export class Board {
  private readonly people = new Map<string, Person>();
  private readonly drafts = new Map<string, Draft>();
  private remarks: Remark[] = [];
  private notices: Remark[] = [];
  private busy = false;
  private seq = 0;
  private variant = 0;
  private readonly ports: Ports;
  readonly requiresAdultConfirmation: boolean;
  private hostNick: string;

  constructor(private readonly options: BoardOptions) {
    this.ports = options.ports ?? defaultPorts;
    this.requiresAdultConfirmation = options.requireAdultConfirmation ?? isProduction();
    this.hostNick = this.validNick(options.host);
    this.people.set(key(this.hostNick), { nick: this.hostNick, seat: "host", muted: false });
  }

  /** The host is a signed-in person who goes by their own name: seat them under it. */
  setHost(nick: string): string {
    const clean = this.validNick(nick);
    if (key(clean) === key(this.hostNick)) {
      (this.people.get(key(this.hostNick)) as Person).nick = clean;
      this.hostNick = clean;
      return clean;
    }
    if (this.people.has(key(clean))) {
      fail("bad_nickname", `The nickname "${clean}" is already taken at this table.`);
    }
    const old = key(this.hostNick);
    const person = this.people.get(old) as Person;
    this.people.delete(old);
    person.nick = clean;
    this.people.set(key(clean), person);
    const draft = this.drafts.get(old);
    if (draft) {
      this.drafts.delete(old);
      this.drafts.set(key(clean), { ...draft, nick: clean });
    }
    this.hostNick = clean;
    return clean;
  }

  // ---- joining ------------------------------------------------------------------------------

  /** Come in as a spectator. In production, joiners must confirm they are adults first. */
  join(nick: string, options: { confirmedAdult?: boolean } = {}): ParticipantView {
    const clean = this.validNick(nick);
    if (this.people.has(key(clean))) {
      fail("bad_nickname", `The nickname "${clean}" is already taken at this table.`);
    }
    if (this.requiresAdultConfirmation && options.confirmedAdult !== true) {
      fail("age_unconfirmed", ADULT_CONFIRMATION_MESSAGE);
    }
    const person: Person = {
      nick: clean,
      seat: "spectator",
      muted: false,
      ...(this.requiresAdultConfirmation ? { adultConfirmedAt: this.ports.now() } : {}),
    };
    this.people.set(key(clean), person);
    return this.personView(person);
  }

  leave(nick: string): void {
    const person = this.seated(nick);
    if (person.seat === "host") fail("board", "The host cannot leave the table.");
    this.remove(person);
  }

  /** Opt in to play. */
  play(nick: string): ParticipantView {
    const person = this.seated(nick);
    if (person.seat === "spectator") person.seat = "player";
    return this.personView(person);
  }

  /** Step back to watching. Anything written is dropped. */
  watch(nick: string): ParticipantView {
    const person = this.seated(nick);
    if (person.seat === "host") fail("board", "The host keeps their seat at the table.");
    person.seat = "spectator";
    this.drafts.delete(key(person.nick));
    return this.personView(person);
  }

  // ---- writing a turn -----------------------------------------------------------------------

  /** Write or change your own turn. Changing it clears "ready" and answers any objections to it. */
  setDraft(nick: string, mode: PlayerMode, text: string): void {
    const person = this.writer(nick);
    const clean = text.trim();
    if (clean.length > MAX_DRAFT) fail("board", `Keep a turn under ${MAX_DRAFT} characters.`);
    if (!clean) {
      this.drafts.delete(key(person.nick));
    } else {
      this.drafts.set(key(person.nick), {
        nick: person.nick,
        mode,
        text: clean,
        ready: false,
        seq: ++this.seq,
      });
    }
    for (const r of this.remarks) {
      if (r.kind === "objection" && r.about && key(r.about) === key(person.nick)) r.answered = true;
    }
  }

  ready(nick: string): void {
    const person = this.writer(nick);
    const draft = this.drafts.get(key(person.nick));
    if (!draft) fail("board", "Write your turn before marking it ready.");
    draft.ready = true;
    draft.readySeq = ++this.seq;
  }

  unready(nick: string): void {
    const person = this.writer(nick);
    const draft = this.drafts.get(key(person.nick));
    if (draft) {
      draft.ready = false;
      draft.readySeq = undefined;
    }
  }

  // ---- talking about it ---------------------------------------------------------------------

  /** Say something to the table. */
  remark(nick: string, text: string): RemarkView {
    const person = this.writer(nick);
    return this.addRemark("remark", person.nick, text);
  }

  /** Object to what someone has written. It stays visible until they change their turn. */
  object(nick: string, aboutNick: string, text: string): RemarkView {
    const person = this.writer(nick);
    const about = this.seated(aboutNick);
    if (key(about.nick) === key(person.nick)) fail("board", "Object to someone else's turn.");
    if (!this.drafts.has(key(about.nick))) {
      fail("board", `${about.nick} has not written anything yet to object to.`);
    }
    return this.addRemark("objection", person.nick, text, about.nick);
  }

  /** Take back your own remark or objection. */
  withdraw(nick: string, remarkId: string): void {
    const person = this.seated(nick);
    const found = this.remarks.find((r) => r.id === remarkId);
    if (!found || key(found.by) !== key(person.nick)) {
      fail("board", "You can only take back your own remarks.");
    }
    this.remarks = this.remarks.filter((r) => r.id !== remarkId);
  }

  // ---- closing a round ----------------------------------------------------------------------

  /** Tell the board whether the story is busy writing a reply. A round does not close meanwhile. */
  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  /** True when the story is idle, someone wrote a turn, and everyone who did marked it ready. */
  get closed(): boolean {
    if (this.busy) return false;
    const live = this.eligible();
    return live.length > 0 && live.every((d) => d.ready);
  }

  /** The lines for the story if the round has closed, clearing the board; otherwise nothing. */
  takeRound(): RoundInput[] | undefined {
    return this.closed ? this.consume() : undefined;
  }

  /** The host closes the round now, taking every written turn whether ready or not. */
  closeRound(actor: Actor): RoundInput[] | undefined {
    requireCan(actor, "board.moderate");
    if (this.busy || this.eligible().length === 0) return undefined;
    return this.consume();
  }

  // ---- moderation, told in the story's own voice (ADR-0015) ---------------------------------

  /** Send someone out of the room. They may come back by joining again. */
  kick(actor: Actor, nick: string, style?: FlavorStyle): RemarkView {
    requireCan(actor, "board.moderate");
    const target = this.target(nick);
    const text = this.say("kick", style, target.nick);
    this.remove(target);
    return this.notice(text);
  }

  /** Hush someone: they can read, but not write, object or remark. Their draft is not submitted. */
  mute(actor: Actor, nick: string, style?: FlavorStyle): RemarkView {
    requireCan(actor, "board.moderate");
    const target = this.target(nick);
    target.muted = true;
    const draft = this.drafts.get(key(target.nick));
    if (draft) {
      draft.ready = false;
      draft.readySeq = undefined;
    }
    return this.notice(this.say("mute", style, target.nick));
  }

  unmute(actor: Actor, nick: string, style?: FlavorStyle): RemarkView {
    requireCan(actor, "board.moderate");
    const target = this.target(nick);
    target.muted = false;
    return this.notice(this.say("unmute", style, target.nick));
  }

  /** Give someone a new name. */
  rename(actor: Actor, nick: string, newNick: string, style?: FlavorStyle): RemarkView {
    requireCan(actor, "board.moderate");
    const target = this.target(nick);
    const clean = this.validNick(newNick);
    const taken = this.people.get(key(clean));
    if (taken && taken !== target) {
      fail("bad_nickname", `The nickname "${clean}" is already taken at this table.`);
    }
    const old = target.nick;
    const text = this.say("rename", style, old, clean);
    this.people.delete(key(old));
    target.nick = clean;
    this.people.set(key(clean), target);
    const draft = this.drafts.get(key(old));
    if (draft) {
      this.drafts.delete(key(old));
      draft.nick = clean;
      this.drafts.set(key(clean), draft);
    }
    for (const r of this.remarks) {
      if (key(r.by) === key(old)) r.by = clean;
      if (r.about && key(r.about) === key(old)) r.about = clean;
    }
    return this.notice(text);
  }

  // ---- what everyone sees -------------------------------------------------------------------

  /** The same snapshot for everyone: players, spectators and the host see one table. */
  view(): BoardView {
    return {
      host: this.hostNick,
      participants: [...this.people.values()].map((p) => this.personView(p)),
      drafts: [...this.drafts.values()]
        .sort((a, b) => a.seq - b.seq)
        .map((d) => ({
          nick: d.nick,
          mode: d.mode,
          text: d.text,
          ready: d.ready,
          objections: this.remarks.filter(
            (r) => r.kind === "objection" && !r.answered && r.about && key(r.about) === key(d.nick),
          ).length,
        })),
      remarks: this.remarks.map((r) => ({ ...r })),
      notices: this.notices.map((r) => ({ ...r })),
      busy: this.busy,
      closed: this.closed,
    };
  }

  // ---- internals ----------------------------------------------------------------------------

  private validNick(nick: string): string {
    const clean = nick.trim();
    if (!NICK.test(clean)) {
      fail(
        "bad_nickname",
        "Pick a nickname of 1 to 24 letters, digits or _ - [ ] \\ ^ { } | (no spaces).",
      );
    }
    return clean;
  }

  private seated(nick: string): Person {
    const person = this.people.get(key(nick.trim()));
    if (!person) fail("board", `"${nick}" has not joined this table.`);
    return person;
  }

  /** Someone who may write: a seated player or the host, and not hushed. */
  private writer(nick: string): Person {
    const person = this.seated(nick);
    if (person.seat === "spectator") fail("board", "Opt in to play before writing a turn.");
    if (person.muted) fail("board", "Your voice is hushed for now: you can read, but not write.");
    return person;
  }

  private target(nick: string): Person {
    const person = this.seated(nick);
    if (person.seat === "host") fail("board", "That power cannot be used on the host.");
    return person;
  }

  private eligible(): Draft[] {
    return [...this.drafts.values()].filter((d) => {
      const person = this.people.get(key(d.nick));
      return person !== undefined && !person.muted && person.seat !== "spectator";
    });
  }

  private consume(): RoundInput[] {
    const lines = this.eligible()
      .sort((a, b) =>
        a.ready === b.ready ? (a.readySeq ?? a.seq) - (b.readySeq ?? b.seq) : a.ready ? -1 : 1,
      )
      .map((d) => ({ by: d.nick, mode: d.mode, text: d.text }));
    this.drafts.clear();
    this.remarks = [];
    return lines;
  }

  private remove(person: Person): void {
    this.people.delete(key(person.nick));
    this.drafts.delete(key(person.nick));
  }

  private addRemark(
    kind: "remark" | "objection",
    by: string,
    text: string,
    about?: string,
  ): RemarkView {
    const clean = text.trim();
    if (!clean) fail("board", "Write something first.");
    if (clean.length > MAX_REMARK) fail("board", `Keep a remark under ${MAX_REMARK} characters.`);
    const remark: Remark = {
      id: this.ports.newId(),
      kind,
      by,
      text: clean,
      ...(about ? { about } : {}),
      t: this.ports.now(),
    };
    this.remarks.push(remark);
    return { ...remark };
  }

  private say(
    action: ModerationAction,
    style: FlavorStyle | undefined,
    target: string,
    newName?: string,
  ): string {
    const n = this.variant++;
    const chosen =
      style ??
      this.options.defaultStyle ??
      (FLAVOR_STYLES[n % FLAVOR_STYLES.length] as FlavorStyle);
    return describeModeration(
      action,
      chosen,
      { host: this.hostNick, target, newName },
      Math.floor(n / FLAVOR_STYLES.length),
    );
  }

  private notice(text: string): RemarkView {
    const remark: Remark = {
      id: this.ports.newId(),
      kind: "notice",
      by: this.hostNick,
      text,
      t: this.ports.now(),
    };
    this.notices.push(remark);
    if (this.notices.length > MAX_NOTICES) this.notices.shift();
    return { ...remark };
  }

  private personView(p: Person): ParticipantView {
    return { nick: p.nick, seat: p.seat, muted: p.muted };
  }
}
