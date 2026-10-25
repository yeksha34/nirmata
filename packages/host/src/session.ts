import { randomUUID } from "node:crypto";
import {
  type Action,
  type Actor,
  type AdventureEvent,
  type AdventureState,
  applyEvent,
  type BuiltContext,
  beginEvent,
  breakEvent,
  buildContext,
  type Card,
  type Chapter,
  ContextBudgetError,
  can,
  cardsWithPlot,
  chaptersOf,
  contextTurnsOf,
  editEvent,
  emptyAdventure,
  gotoEvent,
  type Memory,
  manualPlotEvent,
  memoryOf,
  newEvent,
  type PlotPoint,
  pathTo,
  plotEvent,
  plotPointsOf,
  replay,
  retryParent,
  sourceOf,
  type TokenCounter,
  type Turn,
  turnsOf,
  turnsSincePlot,
  undoEvent,
  undoLastPlotEvent,
  unplotEvent,
  type WorldManifest,
} from "@nirmata/core";
import { type ChatMessage, LlmError, type Provider } from "@nirmata/llm";
import { requireCan, SOLO_HOST } from "./access";
import { candidateCards, extractPlot, plotDue } from "./plot";
import { rulesToCheck } from "./rules";
import {
  type EventSink,
  HostError,
  type HostEvent,
  type HostSettings,
  type Ports,
  type RuleJudge,
  type TurnInput,
  type Violation,
} from "./types";

export interface SessionDeps {
  /**
   * The source world and its cards, copied once when the adventure begins (ADR-0009). After that
   * the session reads the adventure's own copy from its log, so these may be left out when
   * resuming a saved adventure.
   */
  world?: WorldManifest | undefined;
  cards?: readonly Card[] | undefined;
  /** Who this session acts for. Defaults to a host running their own adventure. */
  actor?: Actor | undefined;
  provider: Provider;
  sink: EventSink;
  settings: HostSettings;
  judge?: RuleJudge | undefined;
  ports?: Ports | undefined;
  counter?: TokenCounter | undefined;
  /** Use a different (cheaper) provider for plot extraction. Defaults to `provider`. */
  plotProvider?: Provider | undefined;
}

const defaultPorts: Ports = {
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
};

const CONTINUE_INSTRUCTION = "Continue the scene from exactly where your last reply ended.";

function openingInstruction(arcName?: string): string {
  return [
    "Begin the adventure. Write the opening scene: set the place and the mood,",
    arcName ? `introduce the situation of "${arcName}",` : "introduce the situation,",
    "and end by inviting the player to act. Do not act for the player.",
  ].join(" ");
}

function correctionNote(violations: readonly Violation[]): string {
  const lines = violations.map((v) => `- ${v.name}: ${v.reason}`).join("\n");
  return `<editor_note>\nYour last draft broke these rules:\n${lines}\nWrite the reply again so it obeys every rule. Do not mention this note.\n</editor_note>`;
}

function withNote(messages: readonly ChatMessage[], note: string): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  if (last) last.content += `\n\n${note}`;
  return out;
}

function errorEvent(e: unknown): HostEvent {
  if (e instanceof LlmError) {
    return { type: "error", message: e.userMessage, code: e.code, recoverable: true, cause: e };
  }
  if (e instanceof ContextBudgetError) {
    return {
      type: "error",
      message: e.message,
      code: "context_budget",
      recoverable: true,
      cause: e,
    };
  }
  if (e instanceof HostError) {
    return {
      type: "error",
      message: e.message,
      code: e.code,
      recoverable: e.code !== "persist",
      cause: e,
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return {
    type: "error",
    message: `Something went wrong: ${message}`,
    code: "unexpected",
    recoverable: false,
    cause: e,
  };
}

interface GenerateArgs {
  /** Parent of the host reply that will be written. */
  replyTo: string | null;
  /** Prior turns are read from the path ending here (the pending player input is excluded). */
  turnsAt: string | null;
  input: TurnInput;
  pinned?: readonly string[];
}

/**
 * One adventure being played. Owns the event tree and runs every operation through it:
 * start, submit, retry, continue (streaming, as async generators of HostEvents), and
 * undo, edit, goto, pin (single saved events).
 *
 * Every event is written to the sink *before* it is applied to state, so a crash loses at
 * most the reply being streamed. Only one turn runs at a time.
 */
export class AdventureSession {
  private _state: AdventureState;
  private busy = false;
  private readonly ports: Ports;
  private readonly actor: Actor;

  private constructor(
    private readonly deps: SessionDeps,
    state: AdventureState,
  ) {
    this._state = state;
    this.ports = deps.ports ?? defaultPorts;
    this.actor = deps.actor ?? SOLO_HOST;
  }

  /** Start a new adventure, or resume one from its saved events. */
  static create(deps: SessionDeps, events: readonly AdventureEvent[] = []): AdventureSession {
    return new AdventureSession(deps, events.length ? replay(events) : emptyAdventure);
  }

  get state(): AdventureState {
    return this._state;
  }
  get turns(): Turn[] {
    return turnsOf(this._state);
  }
  get memory(): Memory {
    return memoryOf(this._state);
  }
  /** Chapters on the current branch: the turns that have left the context window, verbatim. */
  get chapters(): Chapter[] {
    return chaptersOf(this._state);
  }
  /** Plot points in force on the current branch. */
  get plotPoints(): PlotPoint[] {
    return plotPointsOf(this._state);
  }
  get isBusy(): boolean {
    return this.busy;
  }

  updateSettings(patch: Partial<HostSettings>): void {
    this.require("settings.change");
    Object.assign(this.deps.settings, patch);
  }

  // ---- streaming operations -------------------------------------------------------------

  /** Take the copy of the source cards, then write the opening scene. */
  start(options: { arcId?: string } = {}, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      self.require("adventure.start");
      if (self._state.log.length) {
        throw new HostError("bad_state", "This adventure has already started.");
      }
      const begin = await self.begin();
      yield { type: "begun", event: begin, cards: begin.cards.length };
      const arc = options.arcId
        ? self.adventure().cards.find((c) => c.fm.id === options.arcId)
        : undefined;
      yield* self.generate(
        {
          replyTo: begin.id,
          turnsAt: begin.id,
          input: { mode: "story", text: openingInstruction(arc?.fm.name) },
          ...(arc ? { pinned: [arc.fm.id] } : {}),
        },
        signal,
      );
    });
  }

  /** The player acts; the host answers. */
  submit(input: TurnInput, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      self.require("adventure.play");
      if (!input.text.trim())
        throw new HostError("nothing_to_do", "Type something to do or say first.");
      if (!self._state.log.length) {
        if (!can(self.actor, "adventure.start")) {
          throw new HostError("forbidden", "The host has not started this adventure yet.");
        }
        const begin = await self.begin();
        yield { type: "begun", event: begin, cards: begin.cards.length };
      }
      const turnsAt = self._state.head;
      const player = newEvent({
        id: self.ports.newId(),
        parentId: turnsAt,
        t: self.ports.now(),
        kind: "player",
        mode: input.mode,
        text: input.text.trim(),
      });
      await self.commit(player);
      yield { type: "player", event: player };
      yield* self.generate({ replyTo: player.id, turnsAt, input }, signal);
    });
  }

  /**
   * Write a different reply. Works after a finished reply (the old one stays reachable as a
   * sibling), and also when the last attempt failed and the player's input has no reply yet.
   */
  retry(signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      self.require("adventure.play");
      const head = self._state.head === null ? undefined : self._state.events.get(self._state.head);
      if (head?.kind === "player") {
        yield* self.generate(
          {
            replyTo: head.id,
            turnsAt: head.parentId,
            input: { mode: head.mode ?? "do", text: head.text },
          },
          signal,
        );
        return;
      }
      const target = retryParent(self._state);
      if (!target) throw new HostError("nothing_to_do", "There is no reply to retry yet.");
      if (target.parentId === null || self._state.events.get(target.parentId)?.kind === "begin") {
        yield* self.generate(
          {
            replyTo: target.parentId,
            turnsAt: target.parentId,
            input: { mode: "story", text: openingInstruction() },
          },
          signal,
        );
        return;
      }
      const player = self._state.events.get(target.parentId);
      if (player?.kind !== "player") {
        throw new HostError("bad_state", "The reply to retry does not follow a player action.");
      }
      yield* self.generate(
        {
          replyTo: player.id,
          turnsAt: player.parentId,
          input: { mode: player.mode ?? "do", text: player.text },
        },
        signal,
      );
    });
  }

  /** Add more to the latest reply without the player saying anything. */
  continueStory(signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      self.require("adventure.play");
      if (!retryParent(self._state))
        throw new HostError("nothing_to_do", "There is nothing to continue yet.");
      const at = self._state.head;
      yield* self.generate(
        { replyTo: at, turnsAt: at, input: { mode: "story", text: CONTINUE_INSTRUCTION } },
        signal,
      );
    });
  }

  // ---- single-event operations ----------------------------------------------------------

  /** Take back the last player action and everything after it. Returns false if there is none. */
  async undo(): Promise<boolean> {
    this.assertIdle();
    this.require("adventure.undo");
    const ev = undoEvent(this._state, this.ports.newId(), this.ports.now());
    if (!ev) return false;
    await this.commit(ev);
    return true;
  }

  /**
   * Replace the text of a turn. The original stays as a sibling. Editing a player action leaves
   * it without a reply; call `retry()` to have the host answer the new wording.
   */
  async edit(targetId: string, text: string): Promise<AdventureEvent> {
    this.assertIdle();
    this.require("adventure.edit-turn");
    const ev = editEvent(this._state, targetId, text, this.ports.newId(), this.ports.now());
    await this.commit(ev);
    return ev;
  }

  /** Jump to any saved moment (browse a branch, or fork from an earlier turn). */
  async goto(target: string | null): Promise<void> {
    this.assertIdle();
    this.require("adventure.branch");
    // "Before everything" is the beginning of the story, not before the copy of the cards.
    const root =
      this._state.log[0] === undefined ? undefined : this._state.events.get(this._state.log[0]);
    const to = target ?? (root?.kind === "begin" ? root.id : null);
    await this.commit(gotoEvent(this.ports.newId(), this.ports.now(), to));
  }

  async pin(fact: string): Promise<void> {
    await this.memoryEvent("pin", fact);
  }

  async unpin(fact: string): Promise<void> {
    await this.memoryEvent("unpin", fact);
  }

  /** Attach a plot point to a card by hand. It never moves the automatic extraction forward. */
  async addPlotPoint(card: string, text: string): Promise<AdventureEvent> {
    this.assertIdle();
    this.require("plot.add");
    if (!this.adventure().cards.some((c) => c.fm.id === card && c.fm.kind !== "rule")) {
      throw new HostError("nothing_to_do", `There is no card "${card}" in this world.`);
    }
    if (!text.trim()) throw new HostError("nothing_to_do", "Write what happened first.");
    if (this._state.head === null) {
      throw new HostError("nothing_to_do", "Nothing has happened yet to attach a plot point to.");
    }
    const ev = manualPlotEvent(this._state, {
      id: this.ports.newId(),
      t: this.ports.now(),
      card,
      text: text.trim(),
    });
    await this.commit(ev);
    return ev;
  }

  /** Take back one plot point. It is not re-extracted: the turns it came from were already read. */
  async revokePlotPoint(pointId: string): Promise<void> {
    this.assertIdle();
    this.require("plot.revoke");
    if (!plotPointsOf(this._state).some((p) => p.id === pointId)) {
      throw new HostError("nothing_to_do", "That plot point is not in force on this branch.");
    }
    await this.commit(
      unplotEvent(this._state, {
        id: this.ports.newId(),
        t: this.ports.now(),
        revokes: [pointId],
      }),
    );
  }

  /** Take back the newest batch of plot points. Returns false when there is none. */
  async undoLastPlot(): Promise<boolean> {
    this.assertIdle();
    this.require("plot.revoke");
    const ev = undoLastPlotEvent(this._state, this.ports.newId(), this.ports.now());
    if (!ev) return false;
    await this.commit(ev);
    return true;
  }

  /**
   * Start a new chapter from here. Where chapters should break is decided elsewhere (and later);
   * for now this is the only thing that creates a break.
   */
  async breakChapter(title?: string): Promise<AdventureEvent> {
    this.assertIdle();
    this.require("chapter.break");
    if (this._state.head === null) {
      throw new HostError("nothing_to_do", "Nothing has happened yet to end a chapter.");
    }
    const ev = breakEvent(this._state, this.ports.newId(), this.ports.now(), title);
    await this.commit(ev);
    return ev;
  }

  // ---- internals ------------------------------------------------------------------------

  private async memoryEvent(
    kind: "pin" | "unpin" | "summary",
    text: string,
  ): Promise<AdventureEvent> {
    this.assertIdle();
    this.require("adventure.pin");
    return this.appendMemory(kind, text);
  }

  private async appendMemory(
    kind: "pin" | "unpin" | "summary",
    text: string,
  ): Promise<AdventureEvent> {
    const ev = newEvent({
      id: this.ports.newId(),
      parentId: this._state.head,
      t: this.ports.now(),
      kind,
      text,
    });
    await this.commit(ev);
    return ev;
  }

  private require(action: Action): void {
    requireCan(this.actor, action);
  }

  /**
   * The world and cards this adventure plays on: its own copy from the log. Only an adventure
   * that has not begun yet (or a legacy log without a copy) falls back to the source.
   */
  private adventure(at: string | null = this._state.head): {
    world: WorldManifest;
    cards: readonly Card[];
  } {
    const own = sourceOf(this._state, at);
    if (own) return own;
    if (this.deps.world && this.deps.cards)
      return { world: this.deps.world, cards: this.deps.cards };
    throw new HostError("bad_state", "This adventure has no cards to play with.");
  }

  /** Duplicate the source cards into the log. The root of every new adventure. */
  private async begin(): Promise<AdventureEvent> {
    const { world, cards } = this.deps;
    if (!world || !cards) {
      throw new HostError("bad_state", "There are no source cards to start this adventure from.");
    }
    const event = beginEvent({ id: this.ports.newId(), t: this.ports.now(), world, cards });
    await this.commit(event);
    return event;
  }

  private assertIdle(): void {
    if (this.busy) throw new HostError("busy", "A turn is already in progress.");
  }

  private async commit(ev: AdventureEvent): Promise<void> {
    try {
      await this.deps.sink.append(ev);
    } catch (e) {
      throw new HostError("persist", `Could not save the adventure: ${(e as Error).message}`);
    }
    this._state = applyEvent(this._state, ev);
  }

  /** Runs one streaming operation: single-flight, always ends with `done`, never throws. */
  private async *guarded(
    body: (self: AdventureSession) => AsyncGenerator<HostEvent>,
  ): AsyncGenerator<HostEvent> {
    if (this.busy) {
      yield errorEvent(new HostError("busy", "A turn is already in progress."));
      yield { type: "done", state: this._state };
      return;
    }
    this.busy = true;
    try {
      yield* body(this);
    } catch (e) {
      yield errorEvent(e);
    } finally {
      this.busy = false;
    }
    yield { type: "done", state: this._state };
  }

  private ceiling(world: WorldManifest) {
    return this.deps.settings.ratingCeiling ?? world.contentRating;
  }

  private async *generate(args: GenerateArgs, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    const { settings, provider, judge } = this.deps;
    const { world, cards } = this.adventure(args.replyTo ?? this._state.head);
    const ceiling = this.ceiling(world);
    const rules = judge ? rulesToCheck(cards, settings.ruleCheck, ceiling) : [];
    const attempts = 1 + (rules.length ? Math.max(0, settings.maxRegenerations) : 0);
    const reserve = settings.budget.reserveReply ?? settings.params.maxTokens ?? 350;

    let note: string | undefined;
    let saved = false;
    let lastContext: BuiltContext | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) yield { type: "attempt", n: attempt };

      const context: BuiltContext = buildContext({
        world,
        cards: cardsWithPlot(cards, plotPointsOf(this._state, args.replyTo)),
        memory: memoryOf(this._state, args.replyTo),
        turns: contextTurnsOf(this._state, args.turnsAt),
        input: args.input,
        budget: { maxTokens: settings.budget.maxTokens, reserveReply: reserve },
        ratingCeiling: ceiling,
        ...(settings.scanTurns !== undefined ? { scanTurns: settings.scanTurns } : {}),
        ...(args.pinned ? { pinnedCards: args.pinned } : {}),
        ...(this.deps.counter ? { counter: this.deps.counter } : {}),
      });
      lastContext = context;
      yield { type: "context", context };

      const messages = note ? withNote(context.messages, note) : context.messages;
      let text = "";
      let finishReason = "stop";
      try {
        for await (const ev of provider.stream(
          { model: settings.model, messages, params: settings.params },
          signal,
        )) {
          if (ev.type === "text") {
            text += ev.text;
            yield { type: "text", text: ev.text };
          } else {
            finishReason = ev.finishReason;
            for (const message of ev.warnings) yield { type: "warning", message };
          }
        }
      } catch (e) {
        if (e instanceof LlmError && e.code === "aborted") {
          yield { type: "stopped", partial: text };
        } else {
          yield errorEvent(e);
        }
        return;
      }

      text = text.trim();
      if (!text) {
        yield errorEvent(
          new HostError(
            "empty_reply",
            "The model sent back an empty reply. Try again, or check the model and context size in Settings.",
          ),
        );
        return;
      }
      if (finishReason === "length") {
        yield {
          type: "warning",
          message:
            "The reply was cut off at the length limit. Use Continue to finish it, or raise the maximum reply length.",
        };
      }

      let violations: Violation[] = [];
      if (judge && rules.length) {
        try {
          violations = await judge({ text, rules, signal });
        } catch (e) {
          yield {
            type: "warning",
            message: `The rule check could not run, so this reply was not checked (${(e as Error).message}).`,
          };
        }
      }

      // Turns this prompt left out are outside the window for good: record where it now begins.
      const dropped = new Set(
        context.excluded.filter((e) => e.reason === "budget").map((e) => e.id),
      );
      const shifted = contextTurnsOf(this._state, args.turnsAt)
        .filter((t) => dropped.has(t.id))
        .at(-1)?.id;

      const reply = newEvent({
        id: this.ports.newId(),
        parentId: args.replyTo,
        t: this.ports.now(),
        kind: "host",
        text,
        cardsUsed: context.included
          .filter((i) => i.section === "rules" || i.section === "canon" || i.section === "lore")
          .map((i) => i.id),
        model: settings.model,
        flags: violations.map((v) => v.ruleId),
        ...(shifted ? { shifted } : {}),
      });
      await this.commit(reply);
      saved = true;
      yield { type: "reply", event: reply, finishReason, violations };

      if (!violations.length) break;
      const willRetry = attempt < attempts;
      yield { type: "rule-violation", violations, willRetry };
      if (!willRetry) break;
      note = correctionNote(violations);
    }

    if (saved && plotDue(this._state, settings.plot)) {
      yield* this.plotNow(false, lastContext, signal);
    }
  }

  /** Look for plot points in the recent turns right now, without waiting for the trigger. */
  plot(signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      self.require("plot.extract");
      yield* self.plotNow(true, undefined, signal);
    });
  }

  /**
   * Read the turns written since the last look and attach what happened to the cards it affected
   * (ADR-0008), saved as one `plot` event. A failure never breaks play; the same turns are read
   * again next time.
   */
  private async *plotNow(
    force: boolean,
    context: BuiltContext | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<HostEvent> {
    const { settings } = this.deps;
    const { cards } = this.adventure();
    const cfg = settings.plot;
    const turns = turnsSincePlot(this._state).slice(-cfg.maxTurns);
    const last = turns[turns.length - 1];
    if (!last) {
      if (force) {
        yield { type: "warning", message: "There is nothing new to read for plot points yet." };
      }
      return;
    }
    const candidates = candidateCards(cards, turns, context);
    if (!candidates.length) {
      if (force) {
        yield {
          type: "warning",
          message:
            "No card is mentioned in the recent story, so there is nothing to attach plot points to.",
        };
      }
      return;
    }

    yield { type: "plotting", turns: turns.length };
    let points: Awaited<ReturnType<typeof extractPlot>>;
    try {
      points = await extractPlot({
        provider: this.deps.plotProvider ?? this.deps.provider,
        model: cfg.model ?? settings.model,
        state: this._state,
        turns,
        candidates,
        maxPoints: cfg.maxPoints,
        signal,
      });
    } catch (e) {
      if (e instanceof LlmError && e.code === "aborted") return;
      const why = e instanceof LlmError ? e.userMessage : (e as Error).message;
      yield {
        type: "warning",
        message: `Plot points could not be updated this time (${why}). Play continues and it will be tried again.`,
      };
      return;
    }

    const event = plotEvent(this._state, {
      id: this.ports.newId(),
      t: this.ports.now(),
      covers: last.id,
      points,
      model: cfg.model ?? settings.model,
    });
    await this.commit(event);
    yield {
      type: "plot",
      event,
      points: plotPointsOf(this._state).filter((p) => p.eventId === event.id),
    };
  }

  /** Current path from the first event to the head, for callers that render history. */
  get path(): AdventureEvent[] {
    return pathTo(this._state);
  }
}
