import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { type AssetStore, assertStoragePath, type StoredFile } from "./store";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Files in a folder on the backend's machine, at `<root>/<storage_path>`. */
export class LocalStore implements AssetStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private locate(path: string): string {
    assertStoragePath(path);
    const full = resolve(join(this.root, path));
    if (!full.startsWith(this.root + sep)) throw new Error("Path leaves the store folder.");
    return full;
  }

  async get(path: string): Promise<StoredFile | undefined> {
    const file = this.locate(path);
    try {
      const data = await readFile(file);
      return { data: new Uint8Array(data), contentType: TYPES[extname(file).toLowerCase()] };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const file = this.locate(path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async remove(path: string): Promise<void> {
    await rm(this.locate(path), { force: true });
  }
}
