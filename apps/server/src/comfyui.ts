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

  async queuePrompt(prompt: ComfyPromptPayload): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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

  async waitForCompletion(promptId: string, maxWaitMs = 600000, pollIntervalMs = 1500): Promise<ComfyExecutionResult> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`);
        if (res.ok) {
          const data = (await res.json()) as Record<string, {
            status?: { status_str: string; completed: boolean; messages?: Array<[string, unknown]> };
            outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
          }>;

          const record = data[promptId];
          if (record && record.outputs) {
            const images: Array<{ filename: string; subfolder: string; type: string }> = [];
            for (const nodeOutput of Object.values(record.outputs)) {
              if (Array.isArray(nodeOutput.images)) {
                for (const img of nodeOutput.images) {
                  images.push({
                    filename: img.filename,
                    subfolder: img.subfolder || "",
                    type: img.type || "output",
                  });
                }
              }
            }

            if (images.length > 0) {
              return { promptId, outputImages: images };
            }
          }

          if (record?.status?.status_str === "error") {
            throw new HttpError(500, "generation_failed", `ComfyUI execution failed: ${JSON.stringify(record.status.messages)}`);
          }
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        // Network blip while polling; continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new HttpError(504, "comfyui_timeout", `Generation timed out after ${Math.round(maxWaitMs / 1000)}s.`);
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
