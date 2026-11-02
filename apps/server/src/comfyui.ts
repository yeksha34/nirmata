import { HttpError } from "./errors";

export interface ComfyUiDevice {
  name: string;
  type: string;
  vramTotal?: number;
  vramFree?: number;
}

export interface ComfyUiStatus {
  online: boolean;
  host: string;
  port: number;
  devices: ComfyUiDevice[];
}

export interface ComfyPromptPayload {
  [nodeId: string]: {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: Record<string, unknown>;
  };
}

export interface ComfyExecutionResult {
  promptId: string;
  outputImages: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
}

interface ComfyHistoryRecord {
  status?: { status_str: string; completed: boolean; messages?: unknown[] };
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
}

export type ComfyPromptLocation =
  | { where: "running" }
  | { where: "pending"; position: number }
  | { where: "missing" }
  | { where: "error"; message: string }
  | { where: "done"; outputImages: ComfyExecutionResult["outputImages"] };

export type ComfyEvent =
  | { kind: "location"; where: "running" | "pending"; position?: number }
  | { kind: "node"; node: string }
  | { kind: "progress"; node: string; value: number; max: number }
  | { kind: "cached"; nodes: string[] };

export interface ComfyWaitOptions {
  clientId?: string;
  onEvent?: (event: ComfyEvent) => void;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  /** How long ComfyUI may stay unreachable before giving up. */
  lostMs?: number;
  /** Consecutive polls the prompt may be absent from queue and history. */
  missingPolls?: number;
}

export class ComfyUiClient {
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly port: number;

  constructor(host = process.env.COMFYUI_HOST || "127.0.0.1", port = Number(process.env.COMFYUI_PORT || "8188")) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
  }

  getEndpoint(): { host: string; port: number; url: string } {
    return { host: this.host, port: this.port, url: this.baseUrl };
  }

  async checkStatus(timeoutMs = 3000): Promise<ComfyUiStatus> {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: controller.signal,
      });
      clearTimeout(id);

      if (!res.ok) {
        return { online: false, host: this.host, port: this.port, devices: [] };
      }

      const data = (await res.json()) as {
        devices?: Array<{
          name: string;
          type: string;
          vram_total?: number;
          vram_free?: number;
        }>;
      };

      const devices: ComfyUiDevice[] = (data.devices || []).map((d) => ({
        name: d.name,
        type: d.type,
        vramTotal: d.vram_total,
        vramFree: d.vram_free,
      }));

      return {
        online: true,
        host: this.host,
        port: this.port,
        devices,
      };
    } catch {
      return { online: false, host: this.host, port: this.port, devices: [] };
    }
  }

  async queuePrompt(prompt: ComfyPromptPayload, clientId?: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientId ? { prompt, client_id: clientId } : { prompt }),
      });

      if (!res.ok) {
        const text = await res.text();
        const code = (res.status >= 400 && res.status < 600 ? res.status : 500) as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503 | 504;
        throw new HttpError(code, "comfyui_error", `ComfyUI failed to queue prompt: ${text}`);
      }

      const data = (await res.json()) as { prompt_id: string };
      return data.prompt_id;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(503, "comfyui_offline", `Could not connect to ComfyUI at ${this.baseUrl}: ${(e as Error).message}`);
    }
  }

  /** Where a prompt is right now, from ComfyUI's own `/queue` and `/history`. */
  async locate(promptId: string): Promise<ComfyPromptLocation> {
    const queue = (await (await fetch(`${this.baseUrl}/queue`)).json()) as {
      queue_running?: unknown[][];
      queue_pending?: unknown[][];
    };
    if ((queue.queue_running ?? []).some((row) => row[1] === promptId)) return { where: "running" };
    const pending = (queue.queue_pending ?? []).findIndex((row) => row[1] === promptId);
    if (pending >= 0) return { where: "pending", position: pending + 1 };

    const res = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`);
    const data = (await res.json()) as Record<string, ComfyHistoryRecord>;
    const record = data[promptId];
    if (!record) return { where: "missing" };
    if (record.status?.status_str === "error") {
      return { where: "error", message: JSON.stringify(record.status.messages ?? []) };
    }
    const outputImages: ComfyExecutionResult["outputImages"] = [];
    for (const out of Object.values(record.outputs ?? {})) {
      for (const img of out.images ?? []) {
        outputImages.push({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
      }
    }
    return outputImages.length > 0 ? { where: "done", outputImages } : { where: "missing" };
  }

  /**
   * Follow a queued prompt until it finishes. There is no overall time limit: a slow card may
   * legitimately take longer than any fixed number. It gives up only when ComfyUI says it failed,
   * the prompt vanished from both queue and history, or ComfyUI stayed unreachable for `lostMs`.
   * Node-level events (`executing`, `progress`) come from ComfyUI's websocket when it is available.
   */
  async waitForCompletion(promptId: string, options: ComfyWaitOptions = {}): Promise<ComfyExecutionResult> {
    const { clientId, onEvent, signal, pollIntervalMs = 1500, lostMs = 120000, missingPolls = 20 } = options;
    const socket = clientId && onEvent ? this.openSocket(clientId, promptId, onEvent) : undefined;
    let unreachableSince: number | undefined;
    let missing = 0;
    try {
      for (;;) {
        if (signal?.aborted) throw new HttpError(409, "cancelled", "Generation was cancelled.");
        try {
          const found = await this.locate(promptId);
          unreachableSince = undefined;
          if (found.where === "done") return { promptId, outputImages: found.outputImages };
          if (found.where === "error") {
            throw new HttpError(500, "generation_failed", `ComfyUI execution failed: ${found.message}`);
          }
          if (found.where === "missing") {
            missing += 1;
            if (missing >= missingPolls) {
              throw new HttpError(502, "comfyui_lost", "ComfyUI no longer has this prompt (restarted or queue cleared).");
            }
          } else {
            missing = 0;
            onEvent?.({ kind: "location", where: found.where, position: found.where === "pending" ? found.position : undefined });
          }
        } catch (err) {
          if (err instanceof HttpError) throw err;
          unreachableSince ??= Date.now();
          if (Date.now() - unreachableSince > lostMs) {
            throw new HttpError(503, "comfyui_offline", `Lost contact with ComfyUI at ${this.baseUrl}.`);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } finally {
      socket?.close();
    }
  }

  /** Stop a prompt: drop it from the queue if waiting, interrupt it if running. */
  async cancel(promptId: string): Promise<void> {
    await fetch(`${this.baseUrl}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    }).catch(() => undefined);
    await fetch(`${this.baseUrl}/interrupt`, { method: "POST" }).catch(() => undefined);
  }

  private openSocket(clientId: string, promptId: string, onEvent: (event: ComfyEvent) => void): { close(): void } | undefined {
    const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Ctor) return undefined;
    try {
      const ws = new Ctor(`ws://${this.host}:${this.port}/ws?clientId=${encodeURIComponent(clientId)}`);
      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const { type, data } = JSON.parse(message.data) as { type: string; data: Record<string, unknown> };
          if (data?.prompt_id && data.prompt_id !== promptId) return;
          if (type === "executing" && typeof data.node === "string") onEvent({ kind: "node", node: data.node });
          else if (type === "progress") {
            onEvent({ kind: "progress", node: String(data.node ?? ""), value: Number(data.value), max: Number(data.max) });
          } else if (type === "execution_cached") onEvent({ kind: "cached", nodes: (data.nodes as string[]) ?? [] });
        } catch {
          // not a message for us
        }
      };
      ws.onerror = () => undefined;
      return { close: () => ws.close() };
    } catch {
      return undefined;
    }
  }

  async fetchImage(filename: string, subfolder = "", type = "output"): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const url = `${this.baseUrl}/view?${params.toString()}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const code = (res.status >= 400 && res.status < 600 ? res.status : 500) as 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503 | 504;
        throw new HttpError(code, "image_not_found", `Failed to fetch generated image: ${res.statusText}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(500, "fetch_failed", `Failed to download image from ComfyUI: ${(e as Error).message}`);
    }
  }
}
