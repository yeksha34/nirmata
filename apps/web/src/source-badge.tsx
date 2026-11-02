import { Tip } from "./controls";
import { T } from "./i18n";

/**
 * Where a world's cards are kept: a green dot for the database, a grey one for the world's folder.
 * Hovering says what that means for editing.
 */
export function SourceBadge({ source }: { source: "database" | "files" }) {
  const db = source === "database";
  return (
    <Tip
      below
      text={
        db
          ? "Cards are kept in the database. Edits here are saved there; the folder copy is not used."
          : "Cards are read from this world's folder. Import the world to keep them in the database."
      }
    >
      <output className={`source-badge ${db ? "source-db" : "source-files"}`}>
        <T>{db ? "Database" : "Files"}</T>
      </output>
    </Tip>
  );
}
