# ADR-0017: A card is XML around markdown

- Status: Accepted 2026-10-26 (the owner chose the shape and the migration in chat)
- Related: [ADR-0006](0006-stack-revision.md), [ADR-0009](0009-story-copies-and-source-permissions.md), [F-55](../features/F-55-story-manager.md)

## Context
Cards were markdown files with a YAML header between `---` lines. YAML is easy to get subtly wrong by hand (an unquoted colon, a bad indent), the header is invisible to anyone reading only the body, and the owner wanted a syntax that reads the same to a person, to the editor on screen and to the model that is later handed the card.

## Decision
1. **A card is one `<card>` element.** The fields are attributes: `id`, `kind`, `name`, and where they apply `role`, `always`, `scope`, `severity`. `<keywords>` (comma separated) and `<summary>` follow as small child tags. Everything after them, up to the closing `</card>` at the end of the file, is markdown, left exactly as written. The body is not XML, so `<`, `&` and code blocks in it need no escaping.

   ```
   <card id="char.marrow" kind="character" name="Marrow" role="npc">
     <keywords>marrow, keeper</keywords>
     <summary>Gruff keeper of the north light.</summary>

   # Marrow

   - **Wants:** the fourth light put out.
   </card>
   ```
2. **Read both, write the new one.** A file that starts with `<card` (after an optional byte-order mark and `<!-- comments -->`) is read as XML+MD; one that starts with `---` is still read as YAML+MD. Whatever the app writes (saving a card on screen, saving a story as a world, a new world's premise) is XML+MD, so a world moves over one card at a time. The extension stays `.md`, so paths, folders, the link linter and git history are untouched.
3. **Hand-written parser, no XML library.** The opening tag and the child tags are parsed by a small function in `packages/core/src/cards.ts`; a real XML parser would choke on markdown. It reports problems in plain words ("the card has no closing </card>", "write each field as name="value"").
4. **Defaults are left out when writing** (`always="false"`, `scope="both"`, `severity="should"`, empty keywords or summary); reading puts them back.
5. **Unknown fields survive.** A text-like extra (`mood="wary"`) is an attribute; an extra that is a list or object (`<data key="mood">["wary"]</data>`) is a child tag holding JSON. In an attribute, a value that looks like a number or `true`/`false` is read back as one (so `plotMax="2"` is a number); `id`, `kind`, `name`, `role`, `scope` and `severity` always stay text.
6. **Text that needs escaping is escaped the XML way** in attributes and child tags (`&amp;`, `&lt;`, `&quot;`); reading decodes those five entities and leaves a stray `&` alone.

## Consequences
+ A card reads as one block, and the fields cannot be mis-indented.
+ Old worlds keep working unchanged; nothing has to be converted.
+ The model can later be given a card or a section as a tagged block without a conversion step.
- Two syntaxes are accepted for as long as old worlds exist; saving a card rewrites an old one in the new form, which shows as a whole-file change in git.
- A markdown body that itself begins with `<keywords>`, `<summary>` or `<data>` would be read as a field. Nothing in a card needs that.
- A string extra that looks like a number (`code="007"`) comes back as a number; put such a value in a `<data>` tag.
- The legacy Python and `.mjs` tools that read frontmatter are not updated; they were already outside this app's path.

## Alternatives considered
- **Every field a child tag, so each section can be addressed alone** (for hiding a `<secret>` from players): more to type, and the secrets rule already lives in one place ([ADR-0016](0016-table-server.md)). Can be added later as more child tags without breaking this form.
- **Keep the YAML header, tag only the body:** smallest change, but the header stays the fragile part.
- **Convert every world once:** a bigger diff for no gain while both forms read.
