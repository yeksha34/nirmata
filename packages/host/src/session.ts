import { randomUUID } from "node:crypto";
import {
  type AdventureEvent,
  type AdventureState,
  applyEvent,
  type BuiltContext,
  buildContext,
  type Card,
  type Chapter,
  ContextBudgetError,
  chaptersOf,
  contextTurnsOf,
  editEvent,
  emptyAdventure,
  gotoEvent,
  liveCardsOf,
  type Memory,
  memoryOf,
  newEvent,
  pathTo,
  replay,
  retryParent,
  type TokenCounter,
  type Turn,
  turnsOf,
  undoEvent,
  type WorldManifest,
} from "@nirmata/core";
import { type ChatMessage, LlmError, type Provider } from "@nirmata/llm";
import { compactionDue, planSegment, runCompaction } from "./compaction";
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
  world: WorldManifest;
  /** Every card in the world, rules included. */
  cards: readonly Card[];
  provider: Provider;
  sink: EventSink;
  settings: HostSettings;
  judge?: RuleJudge | undefined;
  ports?: Ports | undefined;
  counter?: TokenCounter | undefined;
  /** Use a different (cheaper) provider for compaction calls. Defaults to `provider`. */
  compactionProvider?: Provider | undefined;
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

  private constructor(
    private readonly deps: SessionDeps,
    state: AdventureState,
  ) {
    this._state = state;
    this.ports = deps.ports ?? defaultPorts;
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
  /** Chapters written so far on the current branch. */
  get chapters(): Chapter[] {
    return chaptersOf(this._state);
  }
  /** Scene and state cards tracking this adventure on the current branch. */
  get liveCards(): Card[] {
    return liveCardsOf(this._state);
  }
  get isBusy(): boolean {
    return this.busy;
  }

  updateSettings(patch: Partial<HostSettings>): void {
    Object.assign(this.deps.settings, patch);
  }

  // ---- streaming operations -------------------------------------------------------------

  /** Write the opening scene of a fresh adventure. */
  start(options: { arcId?: string } = {}, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      if (self._state.log.length) {
        throw new HostError("bad_state", "This adventure has already started.");
      }
      const arc = options.arcId
        ? self.deps.cards.find((c) => c.fm.id === options.arcId)
        : undefined;
      yield* self.generate(
        {
          replyTo: null,
          turnsAt: null,
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
      if (!input.text.trim())
        throw new HostError("nothing_to_do", "Type something to do or say first.");
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
      if (target.parentId === null) {
        yield* self.generate(
          { replyTo: null, turnsAt: null, input: { mode: "story", text: openingInstruction() } },
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
    const ev = editEvent(this._state, targetId, text, this.ports.newId(), this.ports.now());
    await this.commit(ev);
    return ev;
  }

  /** Jump to any saved moment (browse a branch, or fork from an earlier turn). */
  async goto(target: string | null): Promise<void> {
    this.assertIdle();
    await this.commit(gotoEvent(this.ports.newId(), this.ports.now(), target));
  }

  async pin(fact: string): Promise<void> {
    await this.memoryEvent("pin", fact);
  }

  async unpin(fact: string): Promise<void> {
    await this.memoryEvent("unpin", fact);
  }

  // ---- internals ------------------------------------------------------------------------

  private async memoryEvent(
    kind: "pin" | "unpin" | "summary",
    text: string,
  ): Promise<AdventureEvent> {
    this.assertIdle();
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

  private ceiling() {
    return this.deps.settings.ratingCeiling ?? this.deps.world.contentRating;
  }

  private async *generate(args: GenerateArgs, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    const { settings, provider, world, cards, judge } = this.deps;
    const rules = judge ? rulesToCheck(cards, settings.ruleCheck, this.ceiling()) : [];
    const attempts = 1 + (rules.length ? Math.max(0, settings.maxRegenerations) : 0);
    const reserve = settings.budget.reserveReply ?? settings.params.maxTokens ?? 350;

    let note: string | undefined;
    let saved = false;
    let lastContext: BuiltContext | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) yield { type: "attempt", n: attempt };

      const context: BuiltContext = buildContext({
        world,
        cards: [...cards, ...liveCardsOf(this._state, args.replyTo)],
        memory: memoryOf(this._state, args.replyTo),
        turns: contextTurnsOf(this._state, args.turnsAt),
        input: args.input,
        budget: { maxTokens: settings.budget.maxTokens, reserveReply: reserve },
        ratingCeiling: this.ceiling(),
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

    if (
      saved &&
      compactionDue({ state: this._state, settings: settings.compaction, context: lastContext })
    ) {
      yield* this.compactNow(false, signal);
    }
  }

  /**
   * Close the current chapter on demand: compact everything except the newest few turns, even
   * if no trigger has fired yet.
   */
  compact(signal?: AbortSignal): AsyncGenerator<HostEvent> {
    return this.guarded(async function* (self) {
      yield* self.compactNow(true, signal);
    });
  }

  /**
   * Fold older turns into a summary, a chapter and tracking-card updates (ADR-0007), saved as one
   * `compact` event. If it cannot be done the story is left exactly as it was and will be tried
   * again later; play never fails because of it.
   */
  private async *compactNow(force: boolean, signal?: AbortSignal): AsyncGenerator<HostEvent> {
    const { settings } = this.deps;
    const cfg = settings.compaction;
    const plan = planSegment(
      contextTurnsOf(this._state),
      cfg.keepRecent,
      force ? Math.min(cfg.minTurns, 2) : cfg.minTurns,
    );
    if (!plan) {
      if (force) {
        yield { type: "warning", message: "There is not enough new story to close a chapter yet." };
      }
      return;
    }

    yield { type: "compacting", turns: plan.turns.length };
    let result: Awaited<ReturnType<typeof runCompaction>>;
    try {
      result = await runCompaction({
        provider: this.deps.compactionProvider ?? this.deps.provider,
        model: cfg.model ?? settings.model,
        state: this._state,
        segment: plan.turns,
        previousSummary: memoryOf(this._state).summary,
        liveCards: liveCardsOf(this._state),
        signal,
      });
    } catch (e) {
      if (e instanceof LlmError && e.code === "aborted") return;
      const why = e instanceof LlmError ? e.userMessage : (e as Error).message;
      yield {
        type: "warning",
        message: `The story could not be compacted this time (${why}). Play continues and it will be tried again.`,
      };
      return;
    }
    for (const message of result.warnings) yield { type: "warning", message };

    const event = newEvent({
      id: this.ports.newId(),
      parentId: this._state.head,
      t: this.ports.now(),
      kind: "compact",
      text: result.summary,
      covers: plan.covers,
      chapter: { title: result.chapter.title, text: result.chapter.text },
      cardUpdates: result.cardUpdates,
      model: cfg.model ?? settings.model,
    });
    await this.commit(event);
    yield {
      type: "compacted",
      event,
      chapter: { number: result.chapter.number, title: result.chapter.title },
      cardsUpdated: result.cardUpdates.map((u) => u.id),
    };
  }

  /** Current path from the first event to the head, for callers that render history. */
  get path(): AdventureEvent[] {
    return pathTo(this._state);
  }
}
