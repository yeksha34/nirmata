import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  createLlmJudge,
  defaultSettings,
  type HostSettings,
  isProduction,
  type RuleJudge,
} from "@nirmata/host";
import {
  createAnthropic,
  createFakeProvider,
  createOpenAiCompatible,
  type Provider,
} from "@nirmata/llm";

export interface ServerConfig {
  /** The folder of worlds the host can open. Which one is open is chosen on screen. */
  libraryDir: string;
  hostNick: string;
  hostKey: string;
  /** True when the host key was made up for this run rather than set by the owner. */
  generatedHostKey: boolean;
  port: number;
  bind: string;
  provider: Provider;
  judge: RuleJudge | undefined;
  settings: HostSettings;
  requireAdultConfirmation: boolean;
}

export class ConfigError extends Error {}

const HELP = `Tell Nirmata which model to use:
  NIRMATA_PROVIDER=openai     any OpenAI-style server (KoboldCpp, Ollama, LM Studio, OpenRouter...)
      NIRMATA_BASE_URL=http://localhost:5001   NIRMATA_MODEL=<model>   NIRMATA_API_KEY=<key, if it needs one>
  NIRMATA_PROVIDER=anthropic
      ANTHROPIC_API_KEY=<key>   NIRMATA_MODEL=<model>
  NIRMATA_PROVIDER=demo       scripted replies, no model at all: to try the table out`;

const DEMO_LINES = [
  "The lamp gutters. ",
  "Somewhere beyond the glass, something large turns over in its sleep. ",
  "(This is the demo storyteller; connect a model to hear the real one.) ",
  "What do you do?",
];

/**
 * The server's settings, all from the environment so nothing secret lives in a file that gets
 * committed. Whoever runs the server is the host (ADR-0011); the host key proves it.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): ServerConfig {
  const libraryDir = resolve(cwd, env.NIRMATA_WORLDS ?? "worlds");
  const kind = env.NIRMATA_PROVIDER ?? (env.NIRMATA_BASE_URL ? "openai" : undefined);
  const model = env.NIRMATA_MODEL;
  let provider: Provider;
  let settings: HostSettings;

  if (kind === "demo") {
    provider = createFakeProvider({ chunks: DEMO_LINES }, { label: "the demo storyteller" });
    settings = { ...defaultSettings("demo"), ruleCheck: "off" };
    settings.plot.enabled = false;
  } else if (kind === "openai") {
    if (!env.NIRMATA_BASE_URL) throw new ConfigError(`NIRMATA_BASE_URL is not set.\n${HELP}`);
    if (!model) throw new ConfigError(`NIRMATA_MODEL is not set.\n${HELP}`);
    provider = createOpenAiCompatible({
      baseUrl: env.NIRMATA_BASE_URL,
      ...(env.NIRMATA_API_KEY ? { apiKey: env.NIRMATA_API_KEY } : {}),
    });
    settings = defaultSettings(model, numberOf(env.NIRMATA_CONTEXT_TOKENS));
  } else if (kind === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY ?? env.NIRMATA_API_KEY;
    if (!apiKey) throw new ConfigError(`ANTHROPIC_API_KEY is not set.\n${HELP}`);
    if (!model) throw new ConfigError(`NIRMATA_MODEL is not set.\n${HELP}`);
    provider = createAnthropic({ apiKey });
    settings = defaultSettings(model, numberOf(env.NIRMATA_CONTEXT_TOKENS));
  } else {
    throw new ConfigError(`No model is set up.\n${HELP}`);
  }

  const supplied = env.NIRMATA_HOST_KEY;
  const hostKey = supplied || randomBytes(18).toString("base64url");
  return {
    libraryDir,
    hostNick: env.NIRMATA_HOST_NICK ?? "Host",
    hostKey,
    generatedHostKey: !supplied,
    port: numberOf(env.NIRMATA_PORT) ?? 8788,
    // Only this computer, until the owner chooses otherwise (NIRMATA_BIND=0.0.0.0 for the LAN).
    bind: env.NIRMATA_BIND ?? "127.0.0.1",
    provider,
    judge:
      settings.ruleCheck === "off"
        ? undefined
        : createLlmJudge(provider, { model: settings.model }),
    settings,
    requireAdultConfirmation: isProduction(env),
  };
}

function numberOf(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`"${value}" is not a number I can use.`);
  return n;
}
