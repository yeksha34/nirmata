import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AdventureEvent,
  type Card,
  parseCard,
  parseWorldManifest,
  type WorldManifest,
} from "@nirmata/core";
import {
  createFakeProvider,
  type FakeProvider,
  type FakeScript,
  type GenerateRequest,
} from "@nirmata/llm";
import {
  AdventureSession,
  defaultPlot,
  defaultSettings,
  type EventSink,
  type HostEvent,
  type HostSettings,
  type RuleJudge,
} from "../src";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function loadWorld(name: string): { world: WorldManifest; cards: Card[] } {
  const root = join(REPO_ROOT, "worlds", name);
  const manifest = parseWorldManifest(readFileSync(join(root, "world.json"), "utf8"));
  if (!manifest.ok) throw new Error(manifest.errors.join("; "));
  const cards: Card[] = [];
  for (const dir of ["lore", "characters", "setting", "plot", ".agents/rules"]) {
    for (const file of walk(join(root, dir)).filter(
      (f) => f.endsWith(".md") && !/[\\/]_/.test(f),
    )) {
      const rel = relative(root, file).replaceAll("\\", "/");
      const result = parseCard(rel, readFileSync(file, "utf8"));
      if (!result.ok) throw new Error(`${rel}: ${result.errors.join("; ")}`);
      cards.push(result.card);
    }
  }
  return { world: manifest.world, cards };
}

export function ruleCard(id: string, severity: "must" | "should", check: string): Card {
  return {
    path: `${id}.md`,
    fm: {
      id,
      kind: "rule",
      name: id,
      keywords: [],
      summary: "",
      always: false,
      rating: "everyone",
      scope: "adventure",
      severity,
    } as Card["fm"],
    body: `# ${id}\n\n**Rule:** ${id} must hold.\n\n**Check:** ${check}\n`,
  };
}

export interface MemorySink extends EventSink {
  events: AdventureEvent[];
  failNext?: boolean;
}

export function memorySink(): MemorySink {
  const sink: MemorySink = {
    events: [],
    async append(event) {
      if (sink.failNext) {
        sink.failNext = false;
        throw new Error("disk full");
      }
      sink.events.push(event);
    },
  };
  return sink;
}

export interface Rig {
  session: AdventureSession;
  provider: FakeProvider;
  sink: MemorySink;
  settings: HostSettings;
  cards: Card[];
}

export function rig(
  scripts: FakeScript | FakeScript[] | ((req: GenerateRequest, call: number) => FakeScript),
  opts: {
    extraCards?: Card[];
    /** Keep only the world cards this accepts (rules and extras are added after). */
    filterCards?: (card: Card) => boolean;
    judge?: RuleJudge;
    settings?: Partial<HostSettings>;
    resumeFrom?: AdventureEvent[];
    sink?: MemorySink;
    /** Distinguishes ids when two sessions share one saved adventure. */
    idPrefix?: string;
  } = {},
): Rig {
  const { world, cards: base } = loadWorld("example-world");
  const cards = [...base.filter(opts.filterCards ?? (() => true)), ...(opts.extraCards ?? [])];
  const provider = createFakeProvider(scripts);
  const sink = opts.sink ?? memorySink();
  const settings: HostSettings = {
    ...defaultSettings("fake-model"),
    plot: { ...defaultPlot, enabled: false },
    ruleCheck: "must",
    ...opts.settings,
  };
  let n = 0;
  const session = AdventureSession.create(
    {
      world,
      cards,
      provider,
      sink,
      settings,
      judge: opts.judge,
      ports: { newId: () => `${opts.idPrefix ?? "ev"}${++n}`, now: () => "2026-10-25T10:00:00Z" },
    },
    opts.resumeFrom,
  );
  return { session, provider, sink, settings, cards };
}

export async function run(gen: AsyncGenerator<HostEvent>): Promise<HostEvent[]> {
  const out: HostEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

export const types = (events: readonly HostEvent[]): string[] => events.map((e) => e.type);

export function pick<T extends HostEvent["type"]>(
  events: readonly HostEvent[],
  type: T,
): Extract<HostEvent, { type: T }>[] {
  return events.filter((e): e is Extract<HostEvent, { type: T }> => e.type === type);
}

/** Text of the final (user) message of a request, where the player input and any note live. */
export const lastContent = (req: GenerateRequest | undefined): string =>
  req?.messages[req.messages.length - 1]?.content ?? "";

export const systemContent = (req: GenerateRequest | undefined): string =>
  req?.messages[0]?.content ?? "";
