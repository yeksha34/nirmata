import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { StoryFiles, WorldFiles } from "./files";
import { Table } from "./table";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (message: string) => console.error(`[nirmata] ${message}`);
  const world = new WorldFiles(config.worldDir);
  const manifest = await world.world(); // fail now, not on the first join, if the world is broken

  const table = new Table({
    world,
    stories: new StoryFiles(config.storiesDir),
    provider: config.provider,
    settings: config.settings,
    judge: config.judge,
    hostNick: config.hostNick,
    hostKey: config.hostKey,
    requireAdultConfirmation: config.requireAdultConfirmation,
    log,
  });
  const app = createApp({ table, log });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bind }, (info) => {
    const where = config.bind === "0.0.0.0" ? "every address on this computer" : info.address;
    console.log(`Nirmata is hosting "${manifest.title}" on port ${info.port} (${where}).`);
    console.log(`You are the host, "${config.hostNick}". Your host key:`);
    console.log(
      `  ${config.hostKey}${config.generatedHostKey ? "  (new each time; set NIRMATA_HOST_KEY to keep one)" : ""}`,
    );
    console.log("Anyone who can reach this address can join with a nickname.");
    if (config.requireAdultConfirmation) console.log("Joiners must confirm they are adults.");
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
