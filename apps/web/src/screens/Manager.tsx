import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useSave } from "../app-context";
import { list, words } from "../format";
import { bilingual, T } from "../i18n";
import type {
  BrokenCard,
  Card,
  CardForm,
  CardKind,
  CardTemplate,
  Manifest,
  Perspective,
} from "../types";
import { Modal } from "../ui";

/**
 * The story manager's pieces: a world's cards as a list grouped by kind, an editor for one card
 * (a form, or the file's own text), and the world's own description. A card is a file in the
 * world's folder, written as XML around markdown with its named parts as tags. Stories already
 * begun keep their own copy of the cards.
 */

export const KINDS: Array<{ id: CardKind; group: string; one: string }> = [
  { id: "character", group: "Characters", one: "Character" },
  { id: "place", group: "Places", one: "Place" },
  { id: "lore", group: "Lore", one: "Lore entry" },
  { id: "rule", group: "Rules", one: "Rule" },
  { id: "arc", group: "Story arcs", one: "Story arc" },
  { id: "scene", group: "Scenes", one: "Scene" },
];
const kindOf = (id: CardKind) => KINDS.find((k) => k.id === id) ?? (KINDS[0] as (typeof KINDS)[0]);

export const PERSPECTIVE: Record<Perspective, string> = {
  "first-person": "First person (I)",
  "second-person": "Second person (you)",
  "third-person": "Third person (they)",
};

const SYNTAX = `<card id="char.marrow" kind="character" name="Marrow" role="npc">
  <keywords>marrow, keeper</keywords>
  <summary>Gruff keeper of the north light.</summary>
  <appearance>Weathered, oilskin coat, one lamp-blind eye.</appearance>
  <wants>The fourth light put out.</wants>

# Marrow

Anything else, as plain markdown.
</card>`;

/** "life-outside-the-story" as "Life outside the story", for a part no template names. */
export const humanize = (id: string) => {
  const text = id.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

let templatesOnce: Promise<CardTemplate[]> | undefined;

/** The card templates, fetched once; without them the editor is plain notes. */
export function useTemplates(): CardTemplate[] {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  useEffect(() => {
    templatesOnce ??= api.cardTemplates().catch(() => {
      templatesOnce = undefined;
      return [];
    });
    void templatesOnce.then(setTemplates);
  }, []);
  return templates;
}

export type Dialog =
  | { is: "text"; path: string; file: string; problems?: string[] }
  | { is: "remove"; path: string; name: string };

// ---- the list --------------------------------------------------------------------------------

export function CardList({
  cards,
  broken,
  selected,
  onSelect,
  onNew,
  onDialog,
}: {
  cards: Card[];
  broken: BrokenCard[];
  selected: string | undefined;
  onSelect: (path: string) => void;
  onNew: (kind: CardKind) => void;
  onDialog: (d: Dialog) => void;
}) {
  const [picking, setPicking] = useState(false);
  const present = KINDS.filter((k) => cards.some((c) => c.fm.kind === k.id));
  return (
    <div className="card-index">
      {broken.length > 0 && (
        <div className="broken">
          <strong>
            {broken.length === 1
              ? "One card can't be read"
              : `${broken.length} cards can't be read`}
          </strong>
          <p className="hint">
            Stories can't start until they are fixed or removed. Nothing else is affected.
          </p>
          <ul>
            {broken.map((b) => (
              <li key={b.path}>
                <code>{b.path}</code>
                <span className="error"> {b.problems.join("; ")}</span>
                <span className="card-actions">
                  <button
                    type="button"
                    className="plain"
                    onClick={() =>
                      onDialog({ is: "text", path: b.path, file: b.file, problems: b.problems })
                    }
                  >
                    <T>Fix as text</T>
                  </button>
                  <button
                    type="button"
                    className="plain"
                    onClick={() => onDialog({ is: "remove", path: b.path, name: b.path })}
                  >
                    <T>Remove</T>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cards.length === 0 && broken.length === 0 && (
        <p className="empty">No cards yet. Make the first one below.</p>
      )}
      {present.map((k) => (
        <section key={k.id} className="card-group" aria-label={k.group}>
          <h3 className="eyebrow quiet">
            <T>{k.group}</T>
          </h3>
          <ul className="card-rows">
            {cards
              .filter((c) => c.fm.kind === k.id)
              .map((c) => (
                <li key={c.path}>
                  <button
                    type="button"
                    className="card-row"
                    aria-current={selected === c.path ? "true" : undefined}
                    onClick={() => onSelect(c.path)}
                  >
                    <strong>{c.fm.name}</strong>
                    {c.fm.summary && <span className="muted">{c.fm.summary}</span>}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {picking ? (
        <fieldset className="kind-picker">
          <legend className="eyebrow quiet">
            <T>New card</T>
          </legend>
          <div>
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  setPicking(false);
                  onNew(k.id);
                }}
              >
                <T>{k.one}</T>
              </button>
            ))}
            <button type="button" className="plain" onClick={() => setPicking(false)}>
              <T>Cancel</T>
            </button>
          </div>
        </fieldset>
      ) : (
        <button type="button" className="dashed" onClick={() => setPicking(true)}>
          <span aria-hidden="true">＋</span> <T>New card</T>
        </button>
      )}
    </div>
  );
}

// ---- the world's own description -------------------------------------------------------------

export function WorldFacts({ manifest, onEdit }: { manifest: Manifest; onEdit: () => void }) {
  return (
    <>
      <dl className="facts">
        <dt>
          <T>Title</T>
        </dt>
        <dd>{manifest.title}</dd>
        <dt>
          <T>A line about it</T>
        </dt>
        <dd>
          {manifest.tagline || (
            <span className="muted">
              <T>None yet.</T>
            </span>
          )}
        </dd>
        <dt>
          <T>Genre</T>
        </dt>
        <dd>
          {list(manifest.genre) || (
            <span className="muted">
              <T>None yet.</T>
            </span>
          )}
        </dd>
        <dt>
          <T>Tone</T>
        </dt>
        <dd>
          {list(manifest.tone) || (
            <span className="muted">
              <T>None yet.</T>
            </span>
          )}
        </dd>
        <dt>
          <T>Told in</T>
        </dt>
        <dd>{PERSPECTIVE[manifest.perspective]}</dd>
      </dl>
      <button type="button" onClick={onEdit}>
        <T>Edit the world</T>
      </button>
    </>
  );
}

// ---- the editor ------------------------------------------------------------------------------

/** The template whose parts best match a card's own (plain notes when it has none). */
function bestTemplate(options: CardTemplate[], have: string[]): CardTemplate | undefined {
  if (have.length === 0) return options.find((t) => t.fields.length === 0) ?? options[0];
  let best = options[0];
  let score = -1;
  for (const t of options) {
    const hit = t.fields.filter((f) => have.includes(f.id)).length;
    if (hit > score) {
      best = t;
      score = hit;
    }
  }
  return best;
}

/** Cards that link to this one: their text mentions its file name. */
function linkedFrom(card: Card, all: Card[]): Card[] {
  const file = card.path.split("/").pop() ?? card.path;
  return all.filter(
    (c) =>
      c.path !== card.path &&
      [c.body, ...Object.values(c.fm.fields ?? {})].some(
        (t) => t.includes(`/${file}`) || t.includes(`(${file}`),
      ),
  );
}

const trimmed = (fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([, t]) => t.trim())
      .map(([k, t]) => [k, t.trim()]),
  );

export function CardEditor({
  world,
  kind,
  card,
  all,
  templates,
  onSaved,
  onBack,
  onDialog,
}: {
  world: string;
  kind: CardKind;
  card?: Card | undefined;
  all: Card[];
  templates: CardTemplate[];
  onSaved: (path: string) => void;
  onBack: () => void;
  onDialog: (d: Dialog) => void;
}) {
  const { problem, busy, run } = useSave();
  const options = templates.filter((t) => t.kind === kind);
  const [values, setValues] = useState<Record<string, string>>(card?.fm.fields ?? {});
  const [templateId, setTemplateId] = useState(
    () => (card ? bestTemplate(options, Object.keys(card.fm.fields ?? {})) : options[0])?.id ?? "",
  );
  const template = options.find((t) => t.id === templateId);
  const [name, setName] = useState(card?.fm.name ?? "");
  const [summary, setSummary] = useState(card?.fm.summary ?? "");
  const [keywords, setKeywords] = useState((card?.fm.keywords ?? []).join(", "));
  const [always, setAlways] = useState(card?.fm.always ?? false);
  const [role, setRole] = useState(card?.fm.role ?? template?.role ?? "");
  const [scope, setScope] = useState(card?.fm.scope ?? "both");
  const [severity, setSeverity] = useState(card?.fm.severity ?? "should");
  const [body, setBody] = useState(card?.body ?? "");
  const k = kindOf(kind);

  // the template's parts first, then any part the card has that the template does not name
  const named = template?.fields ?? [];
  const parts = [
    ...named,
    ...Object.keys(values)
      .filter((id) => (values[id] ?? "").trim() && !named.some((f) => f.id === id))
      .map((id) => ({ id, label: humanize(id), hint: "" })),
  ];

  const now = JSON.stringify({
    name: name.trim(),
    summary: summary.trim(),
    keywords: words(keywords),
    always,
    ...(kind === "character" ? { role: role.trim() } : {}),
    ...(kind === "rule" ? { scope, severity } : {}),
    fields: trimmed(Object.fromEntries(parts.map((p) => [p.id, values[p.id] ?? ""]))),
    body,
  });
  const before = card
    ? JSON.stringify({
        name: card.fm.name,
        summary: card.fm.summary ?? "",
        keywords: card.fm.keywords ?? [],
        always: card.fm.always ?? false,
        ...(kind === "character" ? { role: card.fm.role ?? "" } : {}),
        ...(kind === "rule"
          ? { scope: card.fm.scope ?? "both", severity: card.fm.severity ?? "should" }
          : {}),
        fields: trimmed(card.fm.fields ?? {}),
        body: card.body,
      })
    : "";
  const dirty = !card || now !== before;

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const next = options.find((t) => t.id === id);
    if (!card && kind === "character") setRole(next?.role ?? "");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = {};
    for (const p of parts) {
      const text = (values[p.id] ?? "").trim();
      if (text) fields[p.id] = text;
    }
    const form: CardForm = {
      kind,
      name: name.trim(),
      keywords: words(keywords),
      summary: summary.trim(),
      always,
      fields,
      body,
      ...(kind === "character" ? { role: role.trim() } : {}),
      ...(kind === "rule" ? { scope, severity } : {}),
    };
    let path: string | undefined;
    const done = await run(async () => {
      path = (await api.saveCard(world, { ...(card ? { path: card.path } : {}), form })).path;
    });
    if (done && path) onSaved(path);
  };

  const links = card ? linkedFrom(card, all) : [];
  const status = busy ? "Saving…" : !card ? "Not saved yet" : dirty ? "Unsaved changes" : "Saved";
  const isSaved = card && !dirty && !busy;

  return (
    <form className="editor" onSubmit={submit}>
      <button type="button" className="plain back-to-list" onClick={onBack}>
        <T>← All cards</T>
      </button>
      <header className="editor-head">
        <div>
          <p className="eyebrow">
            <T>{card ? `${k.one} card` : `New ${k.one.toLowerCase()}`}</T>
          </p>
          <h2 className="editor-title">{name.trim() || "Untitled"}</h2>
        </div>
        <div className="editor-status">
          <span className={isSaved ? "saved-flag is-saved" : "saved-flag"} role="status">
            {isSaved && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            <T>{status}</T>
          </span>
          {card && (
            <button
              type="button"
              onClick={() => onDialog({ is: "text", path: card.path, file: card.file ?? "" })}
            >
              <T>View raw file</T>
            </button>
          )}
        </div>
      </header>

      {options.length > 1 && (
        <div>
          <label htmlFor="cf-template">{card ? "Parts from" : "Start from"}</label>
          <select
            id="cf-template"
            value={templateId}
            onChange={(e) => pickTemplate(e.target.value)}
          >
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {bilingual(t.label)}
              </option>
            ))}
          </select>
          <p className="hint">
            {template?.description} {card && "Parts you have filled in are kept."}
          </p>
        </div>
      )}

      <div className="two">
        <div>
          <label htmlFor="cf-name">
            <T>Name</T>
          </label>
          <input
            id="cf-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="cf-keywords">
            Keywords <span className="faint">· what brings this card into a scene</span>
          </label>
          <input
            id="cf-keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="fog, mist, haze"
          />
        </div>
      </div>

      <label htmlFor="cf-summary">
        <T>Summary</T>
      </label>
      <input
        id="cf-summary"
        value={summary}
        maxLength={300}
        onChange={(e) => setSummary(e.target.value)}
      />
      <p className="hint">Shown to the storyteller even when the whole card is not brought up.</p>

      {kind === "character" && (
        <>
          <label htmlFor="cf-role">
            <T>Part in the story</T>
          </label>
          <input
            id="cf-role"
            value={role}
            list="cf-roles"
            maxLength={40}
            placeholder="npc, companion, antagonist…"
            onChange={(e) => setRole(e.target.value)}
          />
          <datalist id="cf-roles">
            <option value="npc" />
            <option value="companion" />
            <option value="antagonist" />
            <option value="player-template" />
          </datalist>
        </>
      )}

      {kind === "rule" && (
        <div className="two">
          <div>
            <label htmlFor="cf-severity">
              <T>How strict</T>
            </label>
            <select
              id="cf-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "must" | "should")}
            >
              <option value="should">
                {bilingual("Should: dropped first if space runs short")}
              </option>
              <option value="must">{bilingual("Must: never dropped")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="cf-scope">
              <T>Applies to</T>
            </label>
            <select
              id="cf-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as "chapter" | "story" | "both")}
            >
              <option value="both">{bilingual("Stories and chapters")}</option>
              <option value="story">{bilingual("Stories only")}</option>
              <option value="chapter">{bilingual("Chapters only")}</option>
            </select>
          </div>
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        <span>
          <T>Always in the storyteller's view</T>
          <span className="faint"> · use sparingly: it costs space in every turn</span>
        </span>
      </label>

      {parts.length > 0 && (
        <fieldset className="parts">
          <legend>
            <T>The details</T>
          </legend>
          {parts.map((p) => (
            <div key={p.id}>
              <label htmlFor={`cf-part-${p.id}`}>
                <T>{p.label}</T>
              </label>
              <textarea
                id={`cf-part-${p.id}`}
                rows={2}
                value={values[p.id] ?? ""}
                onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}
              />
              {p.hint && <p className="hint">{p.hint}</p>}
            </div>
          ))}
        </fieldset>
      )}

      <label htmlFor="cf-body">
        {parts.length > 0 ? "More notes" : "Body"} <span className="faint">· markdown</span>
      </label>
      <textarea
        id="cf-body"
        rows={parts.length > 0 ? 4 : 10}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <p className="hint">
        Link to other cards with relative paths, as in <code>[The Fog](../lore/the_fog.md)</code>.
      </p>

      {card && (
        <p className="linked">
          {links.length > 0 ? (
            <>
              Linked from{" "}
              {links.map((c, i) => (
                <span key={c.path}>
                  {i > 0 && (i === links.length - 1 ? " and " : ", ")}
                  <strong>{c.fm.name}</strong>
                </span>
              ))}
              .
            </>
          ) : (
            "No other card links to this one yet."
          )}
        </p>
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="editor-actions">
        <button type="submit" className="primary" disabled={busy || !name.trim() || !dirty}>
          <T>Save</T>
        </button>
        {card && (
          <button
            type="button"
            className="danger"
            onClick={() => onDialog({ is: "remove", path: card.path, name: card.fm.name })}
          >
            <T>Remove</T>
          </button>
        )}
      </div>
    </form>
  );
}

// ---- dialogs: the raw file, and removing ------------------------------------------------------

export function CardTextDialog({
  world,
  path,
  file,
  problems,
  onClose,
  onSaved,
}: {
  world: string;
  path: string;
  file: string;
  problems?: string[] | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { problem, busy, run } = useSave();
  const [text, setText] = useState(file);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.saveCard(world, { path, text }))) onSaved();
  };

  return (
    <Modal titleId="card-text-title" onClose={onClose} wide>
      <form onSubmit={submit}>
        <h2 id="card-text-title">
          <code>{path}</code>
        </h2>
        {problems && problems.length > 0 && <p className="error">{problems.join("; ")}</p>}
        <label htmlFor="ct-text">
          <T>The file</T>
        </label>
        <textarea
          id="ct-text"
          className="code"
          rows={16}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        <details>
          <summary className="hint">
            <T>How a card is written</T>
          </summary>
          <pre className="syntax">{SYNTAX}</pre>
          <p className="hint">
            The fields are attributes of <code>&lt;card&gt;</code>; <code>&lt;keywords&gt;</code>,{" "}
            <code>&lt;summary&gt;</code> and any named part such as <code>&lt;appearance&gt;</code>{" "}
            come first; everything after them is markdown, left as written. Cards written the older
            way, with a <code>---</code> block, are read too.
          </p>
        </details>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            <T>Save</T>
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RemoveCard({
  world,
  path,
  name,
  onClose,
  onSaved,
}: {
  world: string;
  path: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { problem, busy, run } = useSave();
  return (
    <Modal titleId="remove-card-title" onClose={onClose}>
      <h2 id="remove-card-title">Remove {name}?</h2>
      <p>
        This deletes the card's file, <code>{path}</code>, from the world's folder. Stories already
        begun keep their own copy. If the world is in git, the file can be brought back.
      </p>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          <T>Keep it</T>
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            if (await run(() => api.removeCard(world, path))) onSaved();
          }}
        >
          <T>Remove the card</T>
        </button>
      </div>
    </Modal>
  );
}
