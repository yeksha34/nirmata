import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { connectDb } from "@nirmata/db";
import { storesFromEnv } from "@nirmata/storage";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { Library } from "./files";
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
  const library = new Library(config.libraryDir);

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
  const opened = await table.openOnlyWorld();
  const worlds = await library.list();

  const uiDir = join(here, "..", "..", "web", "dist");
  const ui = existsSync(join(uiDir, "index.html")) ? uiDir : undefined;

  const db = await connectDb(process.env);
  const data = db ? { db, stores: storesFromEnv(process.env) } : undefined;
  if (data) console.log("Database connected: asset files are served through it.");
  const app = createApp({ table, log, ui, data });
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
    console.log(`\nYou are the host. Open this link on this computer:\n  ${hostLink}`);
    if (config.bind === "0.0.0.0")
      console.log(
        `Friends on your network join at:\n  http://<this computer's address>:${info.port}/`,
      );
    if (config.requireAdultConfirmation) console.log("Joiners must confirm they are adults.");
    if (ui && process.env.NIRMATA_OPEN !== "0" && !config.requireAdultConfirmation)
      openBrowser(hostLink);
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
