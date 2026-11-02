import { LocalStore } from "./local";
import { SupabaseStore } from "./supabase";
import type { AssetStore } from "./store";

/** The stores a render can live in. `none` has no store: its bytes are gone. */
export interface Stores {
  local?: AssetStore | undefined;
  supabase?: AssetStore | undefined;
}

/**
 * Builds the stores that the environment configures:
 *  - `NIRMATA_ASSET_DIR`: the local folder (render paths are kept under it)
 *  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: the private `vn-assets` bucket
 */
export function storesFromEnv(env: Record<string, string | undefined>): Stores {
  const dir = env.NIRMATA_ASSET_DIR?.trim();
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return {
    local: dir ? new LocalStore(dir) : undefined,
    supabase: url && key ? new SupabaseStore({ url, serviceRoleKey: key }) : undefined,
  };
}
