export interface StoredFile {
  data: Uint8Array;
  contentType: string | undefined;
}

/** One place that holds asset files, addressed by the render's `storage_path`. */
export interface AssetStore {
  get(path: string): Promise<StoredFile | undefined>;
  put(path: string, data: Uint8Array, contentType?: string): Promise<void>;
  /** Removes the file; a file that is not there is not an error. */
  remove(path: string): Promise<void>;
}

export class StorageError extends Error {}

// the same rule the database checks on assets.renders.storage_path: "<world uuid>/<file path>"
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._/-]{1,250}$/;

/** Throws unless the path is a safe `<world uuid>/…` name (no `..`, no leading slash, no odd characters). */
export function assertStoragePath(path: string): void {
  if (!PATH.test(path) || path.includes("..") || path.includes("//")) {
    throw new StorageError(`Not a valid storage path: ${path.slice(0, 80)}`);
  }
}
