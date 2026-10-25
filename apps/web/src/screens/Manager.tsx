import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useSave } from "../app-context";
import { list, words } from "../format";
import type {
  BrokenCard,
  Card,
  CardForm,
  CardKind,
  CardTemplate,
  Manifest,
  Perspective,
  WorldDetail,
} from "../types";
import { Empty, Modal, Panel } from "../ui";

/**
 * The story manager: a world's lore, characters, places, rules and story arcs as cards, and the
 * world itself, all editable from the worlds page without opening the world. A card is a file in
 * the world's folder, written as XML around markdown; the form fills it in, and "As text" shows
 * and edits the file itself. Stories already begun keep their own copy of the cards.
 */

const TABS: Array<{ id: "world" | CardKind; label: string; one?: string }> = [
  { id: "world", label: "World" },
  { id: "lore", label: "Lore", one: "lore entry" },
  { id: "character", label: "Characters", one: "character" },
  { id: "place", label: "Places", one: "place" },
  { id: "rule", label: "Rules", one: "rule" },
  { id: "arc", label: "Story arcs", one: "story arc" },
  { id: "scene", label: "Scenes", one: "scene" },
];

const PERSPECTIVE: Record<Perspective, string> = {
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

type Dialog =
  | { is: "form"; kind: CardKind; card?: Card }
  | { is: "text"; path: string; file: string; problems?: string[] }
  | { is: "remove"; path: string; name: string };

export function Manager({
  name,
  detail,
  onChanged,
  onEditDetails,
}: {
  name: string;
  detail: WorldDetail;
  onChanged: () => void;
  onEditDetails: () => void;
}) {
  const { cards, broken, manifest } = detail;
  const [tab, setTab] = useState<"world" | CardKind>("world");
  const [dialog, setDialog] = useState<Dialog>();
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  useEffect(() => {
    api
      .cardTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([])); // without them the form is plain notes
  }, []);
  const labelOf = (id: string) =>
    templates.flatMap((t) => t.fields).find((f) => f.id === id)?.label ?? humanize(id);
  const tabs = TABS.filter((t) => t.id !== "scene" || cards.some((c) => c.fm.kind === "scene"));
  const shown = tab === "world" ? [] : cards.filter((c) => c.fm.kind === tab);
  const current = TABS.find((t) => t.id === tab);
  const close = () => setDialog(undefined);
  const saved = () => {
    close();
    onChanged();
  };

  return (
    <Panel title="Story manager">
      {broken.length > 0 && <Broken broken={broken} onDialog={setDialog} />}

      <nav className="tabs" aria-label="What to manage">
        {tabs.map((t) => {
          const count =
            t.id === "world" ? undefined : cards.filter((c) => c.fm.kind === t.id).length;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "true" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {count !== undefined && <span className="tab-count"> {count}</span>}
            </button>
          );
        })}
      </nav>

      {tab === "world" ? (
        manifest && <WorldFacts manifest={manifest} onEdit={onEditDetails} />
      ) : (
        <>
          <div className="manager-head">
            <button
              type="button"
              className="primary"
              onClick={() => setDialog({ is: "form", kind: tab })}
            >
              New {current?.one}
            </button>
            {tab === "rule" && (
              <p className="hint">Rules are checked against everything the storyteller writes.</p>
            )}
          </div>
          {shown.length === 0 ? (
            <Empty>No {current?.label.toLowerCase()} yet.</Empty>
          ) : (
            <ul className="card-list">
              {shown.map((c) => (
                <CardRow key={c.path} card={c} labelOf={labelOf} onDialog={setDialog} />
              ))}
            </ul>
          )}
        </>
      )}

      <p className="hint">
        Stories already begun keep their own copy of the cards, so changes here show up in stories
        you start afterwards.
      </p>

      {dialog?.is === "form" && (
        <CardFormDialog
          world={name}
          kind={dialog.kind}
          card={dialog.card}
          templates={templates}
          onClose={close}
          onSaved={saved}
        />
      )}
      {dialog?.is === "text" && (
        <CardTextDialog world={name} {...dialog} onClose={close} onSaved={saved} />
      )}
      {dialog?.is === "remove" && (
        <RemoveCard world={name} {...dialog} onClose={close} onSaved={saved} />
      )}
    </Panel>
  );
}

function WorldFacts({ manifest, onEdit }: { manifest: Manifest; onEdit: () => void }) {
  return (
    <>
      <dl className="facts">
        <dt>Title</dt>
        <dd>{manifest.title}</dd>
        <dt>A line about it</dt>
        <dd>{manifest.tagline || <span className="muted">None yet.</span>}</dd>
        <dt>Genre</dt>
        <dd>{list(manifest.genre) || <span className="muted">None yet.</span>}</dd>
        <dt>Tone</dt>
        <dd>{list(manifest.tone) || <span className="muted">None yet.</span>}</dd>
        <dt>Told in</dt>
        <dd>{PERSPECTIVE[manifest.perspective]}</dd>
      </dl>
      <button type="button" onClick={onEdit}>
        Edit the world
      </button>
    </>
  );
}

function Broken({ broken, onDialog }: { broken: BrokenCard[]; onDialog: (d: Dialog) => void }) {
  return (
    <div className="broken">
      <strong>
        {broken.length === 1 ? "One card can't be read" : `${broken.length} cards can't be read`}
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
                Fix as text
              </button>
              <button
                type="button"
                className="plain"
                onClick={() => onDialog({ is: "remove", path: b.path, name: b.path })}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardRow({
  card,
  labelOf,
  onDialog,
}: {
  card: Card;
  labelOf: (id: string) => string;
  onDialog: (d: Dialog) => void;
}) {
  const { fm } = card;
  return (
    <li className="card-item">
      <details>
        <summary>
          <strong>{fm.name}</strong>
          {fm.always && <span className="chip">always in view</span>}
          {fm.kind === "rule" && fm.severity === "must" && <span className="chip">must</span>}
          {fm.summary && <span className="muted"> {fm.summary}</span>}
        </summary>
        {fm.keywords && fm.keywords.length > 0 && (
          <p className="hint">Comes up when someone says: {list(fm.keywords)}</p>
        )}
        {Object.entries(fm.fields ?? {}).map(([id, text]) => (
          <p key={id} className="card-part">
            <strong>{labelOf(id)}:</strong> {text}
          </p>
        ))}
        {card.body.trim() ? (
          <p className="card-body">{card.body.trim()}</p>
        ) : (
          Object.keys(fm.fields ?? {}).length === 0 && <p className="card-body">(no text)</p>
        )}
      </details>
      <span className="card-actions">
        <button
          type="button"
          className="plain"
          onClick={() => onDialog({ is: "form", kind: fm.kind, card })}
        >
          Edit
        </button>
        <button
          type="button"
          className="plain"
          onClick={() => onDialog({ is: "text", path: card.path, file: card.file ?? "" })}
        >
          As text
        </button>
        <button
          type="button"
          className="plain danger"
          onClick={() => onDialog({ is: "remove", path: card.path, name: fm.name })}
        >
          Remove
        </button>
      </span>
    </li>
  );
}

/** "life-outside-the-story" as "Life outside the story", for a part no template names. */
const humanize = (id: string) => {
  const text = id.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

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

function CardFormDialog({
  world,
  kind,
  card,
  templates,
  onClose,
  onSaved,
}: {
  world: string;
  kind: CardKind;
  card?: Card;
  templates: CardTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { problem, busy, run } = useSave();
  const label = TABS.find((t) => t.id === kind)?.one ?? "card";
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

  // the template's parts first, then any part the card has that the template does not name
  const named = template?.fields ?? [];
  const parts = [
    ...named,
    ...Object.keys(values)
      .filter((id) => (values[id] ?? "").trim() && !named.some((f) => f.id === id))
      .map((id) => ({ id, label: humanize(id), hint: "" })),
  ];

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
    if (await run(() => api.saveCard(world, { ...(card ? { path: card.path } : {}), form }))) {
      onSaved();
    }
  };

  return (
    <Modal titleId="card-form-title" onClose={onClose} wide>
      <form onSubmit={submit}>
        <h2 id="card-form-title">{card ? `Edit ${card.fm.name}` : `New ${label}`}</h2>

        {options.length > 1 && (
          <>
            <label htmlFor="cf-template">{card ? "Parts from" : "Start from"}</label>
            <select
              id="cf-template"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
            >
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="hint">
              {template?.description} {card && "Parts you have filled in are kept."}
            </p>
          </>
        )}

        <label htmlFor="cf-name">Name</label>
        <input
          id="cf-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label htmlFor="cf-summary">One line about it</label>
        <input
          id="cf-summary"
          value={summary}
          maxLength={300}
          onChange={(e) => setSummary(e.target.value)}
        />
        <p className="hint">Shown to the storyteller even when the whole card is not brought up.</p>

        {kind === "character" && (
          <>
            <label htmlFor="cf-role">Part in the story</label>
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
              <label htmlFor="cf-severity">How strict</label>
              <select
                id="cf-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "must" | "should")}
              >
                <option value="should">Should: dropped first if space runs short</option>
                <option value="must">Must: never dropped</option>
              </select>
            </div>
            <div>
              <label htmlFor="cf-scope">Applies to</label>
              <select
                id="cf-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "chapter" | "story" | "both")}
              >
                <option value="both">Stories and chapters</option>
                <option value="story">Stories only</option>
                <option value="chapter">Chapters only</option>
              </select>
            </div>
          </div>
        )}

        <label htmlFor="cf-keywords">Comes up when someone says</label>
        <input
          id="cf-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="fog, mist, haze"
        />
        <p className="hint">Words that bring this card into view, separated by commas.</p>

        <label className="check">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          Always in the storyteller's view
        </label>
        <p className="hint">Use sparingly: it uses space in every turn.</p>

        {parts.length > 0 && (
          <fieldset className="parts">
            <legend>The details</legend>
            {parts.map((p) => (
              <div key={p.id}>
                <label htmlFor={`cf-part-${p.id}`}>{p.label}</label>
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

        <label htmlFor="cf-body">{parts.length > 0 ? "More notes" : "The card"}</label>
        <textarea
          id="cf-body"
          rows={parts.length > 0 ? 4 : 10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="hint">
          Markdown. Link to other cards with relative paths, as in{" "}
          <code>[The Fog](../lore/the_fog.md)</code>.
        </p>

        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CardTextDialog({
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
          Edit <code>{path}</code> as text
        </h2>
        {problems && problems.length > 0 && <p className="error">{problems.join("; ")}</p>}
        <label htmlFor="ct-text">The file</label>
        <textarea
          id="ct-text"
          className="code"
          rows={16}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        <details>
          <summary className="hint">How a card is written</summary>
          <pre className="syntax">{SYNTAX}</pre>
          <p className="hint">
            The fields are attributes of <code>&lt;card&gt;</code>; <code>&lt;keywords&gt;</code>{" "}
            and <code>&lt;summary&gt;</code> come first; everything after them is markdown, left as
            written. Cards written the older way, with a <code>---</code> block, are read too.
          </p>
        </details>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveCard({
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
          Keep it
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            if (await run(() => api.removeCard(world, path))) onSaved();
          }}
        >
          Remove the card
        </button>
      </div>
    </Modal>
  );
}
