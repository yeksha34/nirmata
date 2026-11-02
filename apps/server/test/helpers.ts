import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPlot, defaultSettings, type HostSettings } from "@nirmata/host";
import {
  createFakeProvider,
  type FakeProvider,
  type FakeScript,
  type Provider,
} from "@nirmata/llm";
import type { Hono } from "hono";
import { afterEach } from "vitest";
import { createApp, type DataDeps, Library, StoryFiles, Table, type WorldFiles } from "../src";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON from the API
export type Json = any;

export const HOST_KEY = "correct-horse-battery";

/** A throwaway library holding a copy of the example world, so tests may write freely. */
export async function tempLibrary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nirmata-server-"));
  const library = join(dir, "worlds");
  await mkdir(library);
  await cp(join(REPO_ROOT, "worlds", "example-world"), join(library, "example-world"), {
    recursive: true,
    filter: (src) => !src.includes(`${sep}stories${sep}`),
  });
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return library;
}

/** Just the folder of the copied example world. */
export async function tempWorld(): Promise<string> {
  return join(await tempLibrary(), "example-world");
}

export interface Rig {
  app: Hono;
  table: Table;
  provider: FakeProvider;
  library: Library;
  world: WorldFiles;
  stories: StoryFiles;
  settings: HostSettings;
  logs: string[];
}

export async function rig(
  script: FakeScript | FakeScript[] | Parameters<typeof createFakeProvider>[0] = {
    chunks: ["The lamp ", "gutters."],
  },
  opts: {
    requireAdultConfirmation?: boolean;
    /** An existing library folder to use instead of a fresh one. */
    library?: string;
    /** Which world to have open (default the example); "none" opens nothing. */
    world?: string;
    settings?: Partial<HostSettings>;
    /** Put something between the table and the fake model, e.g. to hold a reply back. */
    wrap?: (inner: FakeProvider) => Provider;
    /** The database and file stores, to try the asset routes with fakes. */
    data?: DataDeps;
  } = {},
): Promise<Rig> {
  const library = new Library(opts.library ?? (await tempLibrary()));
  const worldName = opts.world ?? "example-world";
  const world = library.open(worldName === "none" ? "example-world" : worldName);
  const stories = new StoryFiles(world.storiesDir);
  const provider = createFakeProvider(script);
  const settings: HostSettings = {
    ...defaultSettings("fake-model"),
    plot: { ...defaultPlot, enabled: false },
    ruleCheck: "off",
    ...opts.settings,
  };
  const logs: string[] = [];
  const table = new Table({
    library,
    provider: opts.wrap ? opts.wrap(provider) : provider,
    settings,
    hostNick: "Dana",
    hostKey: HOST_KEY,
    requireAdultConfirmation: opts.requireAdultConfirmation ?? false,
    log: (m) => logs.push(m),
  });
  if (opts.world !== "none") await table.useWorld(worldName);
  const app = createApp({ table, log: (m) => logs.push(m), data: opts.data });
  cleanups.push(async () => {
    table.close();
    await table.idle();
  });
  return { app, table, provider, library, world, stories, settings, logs };
}

/** A person at the table, talking to the app the way a browser would. */
export class Client {
  constructor(
    readonly app: Hono,
    public token?: string,
  ) {}

  async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json }> {
    const res = await this.app.request(path, {
      method,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  get = (path: string) => this.call("GET", path);
  post = (path: string, body: unknown = {}) => this.call("POST", path, body);
  put = (path: string, body: unknown) => this.call("PUT", path, body);
  patch = (path: string, body: unknown) => this.call("PATCH", path, body);
  del = (path: string) => this.call("DELETE", path);

  /** Join (as the host when given the key); remembers the token. */
  async join(nick: string, extra: Record<string, unknown> = {}) {
    const res = await this.call("POST", "/api/join", { nick, ...extra });
    if (res.status === 201) this.token = res.body.token;
    return res;
  }

  async asPlayer(nick: string) {
    const res = await this.join(nick);
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    await this.post("/api/play");
    return this;
  }

  /** Open the live stream and collect what arrives. */
  async listen(): Promise<Listener> {
    const res = await this.app.request("/api/events", {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (res.status !== 200) throw new Error(`events: ${res.status}`);
    return new Listener(res);
  }
}

export interface Message {
  event: string;
  data: Json;
}

export class Listener {
  readonly messages: Message[] = [];
  private done = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(res: Response) {
    this.reader = (res.body as ReadableStream<Uint8Array>).getReader();
    void this.pump();
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const end = buffer.indexOf("\n\n");
          if (end < 0) break;
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data && event !== "ping")
            this.messages.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // the connection was closed
    }
    this.done = true;
  }

  of(event: string): Json[] {
    return this.messages.filter((m) => m.event === event).map((m) => m.data);
  }

  /** The `story` events, by their `type`. */
  story(type: string): Json[] {
    return this.of("story").filter((d) => d.type === type);
  }

  get ended(): boolean {
    return this.done;
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}

export async function until(check: () => boolean, what = "something to happen", ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
