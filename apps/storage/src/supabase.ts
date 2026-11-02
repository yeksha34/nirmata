import { type AssetStore, assertStoragePath, StorageError, type StoredFile } from "./store";

export interface SupabaseStoreOptions {
  /** The project address, e.g. https://<ref>.supabase.co */
  url: string;
  /** The service role key. Server side only: it bypasses every access rule. */
  serviceRoleKey: string;
  bucket?: string;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Files in a private Supabase Storage bucket, reached over its REST API. */
export class SupabaseStore implements AssetStore {
  private readonly base: string;
  private readonly bucket: string;
  private readonly key: string;
  private readonly http: typeof fetch;

  constructor(options: SupabaseStoreOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/storage/v1`;
    this.bucket = options.bucket ?? "vn-assets";
    this.key = options.serviceRoleKey;
    this.http = options.fetch ?? fetch;
  }

  private objectUrl(path: string): string {
    assertStoragePath(path);
    return `${this.base}/object/${this.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }

  async get(path: string): Promise<StoredFile | undefined> {
    const res = await this.http(this.objectUrl(path), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return undefined; // Storage answers a missing object with 400 or 404
    if (!res.ok) throw new StorageError(`Storage read failed (${res.status}).`);
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? undefined,
    };
  }

  async put(path: string, data: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    const res = await this.http(this.objectUrl(path), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "false" }),
      body: data as BodyInit,
    });
    if (!res.ok) throw new StorageError(`Storage upload failed (${res.status}).`);
  }

  async remove(path: string): Promise<void> {
    assertStoragePath(path);
    const res = await this.http(`${this.base}/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok && res.status !== 404) throw new StorageError(`Storage delete failed (${res.status}).`);
  }
}
