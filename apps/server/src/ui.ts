import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Context } from "hono";
import { inside } from "./files";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

async function read(dir: string, rel: string): Promise<Buffer | undefined> {
  try {
    return await readFile(inside(dir, rel));
  } catch {
    // missing, a directory, or outside the folder: all the same to the caller
    return undefined;
  }
}

/**
 * Serves the built screens. Any address that is not a file (and not under /api) gets the front
 * page, so the screens can use their own addresses.
 */
export function uiHandler(dir: string) {
  return async (c: Context): Promise<Response> => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.notFound();
    }
    if (path.startsWith("/api/")) return c.notFound();
    const rel = path === "/" ? "index.html" : path.slice(1);
    let body = await read(dir, rel);
    let name = rel;
    if (!body && !extname(rel)) {
      body = await read(dir, "index.html");
      name = "index.html";
    }
    if (!body) return c.notFound();
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": TYPES[extname(name).toLowerCase()] ?? "application/octet-stream",
        "cache-control": name.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  };
}
