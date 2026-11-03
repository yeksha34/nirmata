import { type Db, getRenderFile } from "@nirmata/db";
import type { Stores } from "@nirmata/storage";
import type { Context, Hono } from "hono";
import { HttpError } from "./errors";
import type { Seat } from "./table";

/** The database and the file stores, when the server is configured with them. */
export interface DataDeps {
  db: Db;
  stores: Stores;
}

/**
 * Routes that read through the database and the stores. Only the host may call them for now:
 * people are not signed in to the database yet, so the backend asks for itself, after it has
 * checked who is asking.
 */
export function registerAssetRoutes(app: Hono, data: DataDeps, seatOf: (c: Context) => Seat): void {
  const requireHost = (c: Context) => {
    if (!seatOf(c).host) throw new HttpError(403, "forbidden", "Only the host may do that.");
  };

  app.get("/api/health/db", async (c) => {
    requireHost(c);
    return c.json(await data.db.health());
  });

  // the backend serves the file; the caller never learns which store holds it
  app.get("/api/assets/renders/:id/file", async (c) => {
    requireHost(c);
    const render = await getRenderFile(data.db, c.req.param("id"));
    if (!render) throw new HttpError(404, "not_found", "There is no such file.");
    if (render.store === "none") {
      throw new HttpError(404, "gone", "The file was deleted; only its record is kept.");
    }
    const store = data.stores[render.store];
    if (!store) {
      throw new HttpError(
        503,
        "store_unavailable",
        "That file's store is not set up on this server.",
      );
    }
    const file = await store.get(render.storagePath);
    if (!file) throw new HttpError(404, "not_found", "The file is not in its store.");
    return c.body(new Uint8Array(file.data), 200, {
      "Content-Type": render.contentType ?? file.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    });
  });
}
