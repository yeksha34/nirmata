import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { GoTrue, SessionStore } from "@nirmata/auth";
import { connectDb, type Db } from "@nirmata/db";
import { storesFromEnv } from "@nirmata/storage";
import { createApp } from "./app";
import type { AuthDeps } from "./auth-routes";
import { ConfigError, loadConfig } from "./config";
import { Library } from "./files";
import { DbImages } from "./image-store";
import { DbLore } from "./lore-store";
import { Table } from "./table";

/** Open the browser on the host's own link, so the person who ran the server just lands in it. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {
    // the link is printed anyway
  }
}

/** Sign-in is on when the Supabase address and publishable key are set. */
function authFromEnv(
  env: NodeJS.ProcessEnv,
  db: Db | undefined,
  port: number,
): AuthDeps | undefined {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return undefined;
  const gotrue = new GoTrue({
    url,
    publishableKey: key,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  });
  return {
    gotrue,
    sessions: new SessionStore(gotrue),
    db,
    siteUrl: env.NIRMATA_SITE_URL?.trim() || `http://127.0.0.1:${port}`,
  };
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  if (typeof process.loadEnvFile === "function") {
    const candidates = [
      process.env.INIT_CWD ? join(process.env.INIT_CWD, ".env") : undefined,
      join(process.cwd(), ".env"),
      join(here, "..", ".env"),
      join(here, "..", "..", ".env"),
    ];
    for (const file of candidates) {
      if (file && existsSync(file)) {
        try {
          process.loadEnvFile(file);
        } catch {
          // ignore unreadable .env
        }
      }
    }
  }

  const config = loadConfig();
  const log = (message: string) => console.error(`[nirmata] ${message}`);
  const db = await connectDb(process.env);
  // an imported world keeps its cards in the database, read and written as the signed-in host
  let hostUser: () => string | undefined = () => undefined;
  const stores = storesFromEnv(process.env);
  const library = new Library(config.libraryDir, {
    lore: db ? new DbLore(db, () => hostUser()) : undefined,
    images: db ? new DbImages(db, stores, () => hostUser()) : undefined,
  });

  const table = new Table({
    library,
    provider: config.provider,
    settings: config.settings,
    judge: config.judge,
    hostNick: config.hostNick,
    hostKey: config.hostKey,
    requireAdultConfirmation: config.requireAdultConfirmation,
    log,
  });
  hostUser = () => table.hostUserId();
  const opened = await table.openOnlyWorld();
  const worlds = await library.list();

  const uiDir = join(here, "..", "..", "web", "dist");
  const ui = existsSync(join(uiDir, "index.html")) ? uiDir : undefined;

  const data = db ? { db, stores } : undefined;
  if (data) console.log("Database connected: asset files are served through it.");
  const auth = authFromEnv(process.env, db, config.port);
  if (auth) console.log("Sign-in through Supabase is on (email and password).");
  const app = createApp({ table, log, ui, data, auth });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bind }, (info) => {
    const host = config.bind === "0.0.0.0" ? "localhost" : info.address;
    const link = `http://${host}:${info.port}/`;
    const hostLink = `${link}#host=${encodeURIComponent(config.hostKey)}`;
    console.log(
      `Nirmata is ready: ${worlds.length} world${worlds.length === 1 ? "" : "s"} in ${config.libraryDir}`,
    );
    if (opened) console.log(`Opened "${opened.title}" (the only world there).`);
    if (!ui)
      console.log(
        "The screens are not built yet: run `corepack pnpm --filter @nirmata/web build`.",
      );
    if (auth) {
      console.log(
        `\nSign in at:\n  ${link}login\nThe host is the signed-in account that was invited as host.\n(Obsolete host-key link, development only:\n  ${hostLink})`,
      );
    } else {
      console.log(`\nYou are the host. Open this link on this computer:\n  ${hostLink}`);
    }
    if (config.bind === "0.0.0.0")
      console.log(
        `Friends on your network join at:\n  http://<this computer's address>:${info.port}/`,
      );
    if (config.requireAdultConfirmation) console.log("Joiners must confirm they are adults.");
    if (ui && process.env.NIRMATA_OPEN !== "0" && !config.requireAdultConfirmation)
      openBrowser(auth ? link : hostLink);
  });

  const stop = () => {
    table.close();
    server.close();
    // let a reply that is mid-write finish saving, then go
    void table.idle().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  console.error(e instanceof ConfigError ? e.message : `Could not start: ${(e as Error).message}`);
  process.exit(1);
});
