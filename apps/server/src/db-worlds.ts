import type { Db } from "@nirmata/db";
import { HostError } from "@nirmata/host";
import { createWorldInDb, type NewWorld, WorldNotAllowed } from "@nirmata/importer";
import type { WorldSummary } from "./files";

/**
 * Makes a world in the database for whoever is signed in as the host. With a database there is no
 * folder to fall back on: a world is made here or not at all.
 */
export function dbWorldCreator(
  db: Db,
  userOf: () => string | undefined,
): (input: NewWorld) => Promise<WorldSummary> {
  return async (input) => {
    const user = userOf();
    if (!user) throw new HostError("bad_state", "Sign in to make a world.");
    try {
      const made = await createWorldInDb(db, user, input);
      return { ...made, stories: 0 };
    } catch (e) {
      if (e instanceof WorldNotAllowed) {
        throw new HostError("bad_state", "Only an account that may found worlds can make one.");
      }
      throw e;
    }
  };
}
