import type { CardKind } from "./schema";

/**
 * Templates for the things stories are most often made of: a person, a creature, a place, a
 * custom, a group. A template is only a list of named parts (fields) a card of that kind
 * usually has, with a hint for each, so a new card starts with the right blanks. They were
 * generalised from the labels that long-running story worlds keep repeating on their character,
 * place and lore cards (kind, age, position, appearance, manner, voice, relations ...). A card
 * stores only the fields that are filled in, and may carry fields no template lists.
 */

export interface FieldSpec {
  id: string;
  label: string;
  hint: string;
}

export interface CardTemplate {
  /** Unique across all templates: `character.person`. */
  id: string;
  kind: CardKind;
  label: string;
  description: string;
  /** A character's part in the story, when the template implies one. */
  role?: string;
  fields: FieldSpec[];
}

const f = (id: string, label: string, hint: string): FieldSpec => ({ id, label, hint });

const KIND = f("kind", "Kind", "What it is: human, spirit, android, a kind of inn…");
const AGE = f("age", "Age", "A number, or how old they seem or are said to be.");
const APPEARANCE = f("appearance", "Appearance", "What anyone meeting them would notice first.");
const MANNER = f("manner", "Manner", "How they carry themselves and treat people.");
const VOICE = f("voice", "Voice", "How they speak. A line or two of sample speech helps most.");
const WANTS = f("wants", "Wants", "What they are after, and what they would give up for it.");
const SECRETS = f("secrets", "Secrets", "Host-only. Never revealed unprompted.");
const RELATIONS = f("relations", "Relations", "Who they answer to, protect, fear or are tied to.");
const HISTORY = f("history", "History", "What has happened to them so far.");
const HOOKS = f(
  "hooks",
  "Hooks",
  "Ways the story can reach this: reasons to come here, threads to pull.",
);
const CUSTOMS = f("customs", "Customs", "Habits, rules and manners that belong to it.");
const WHAT = f("what", "What it is", "Say it plainly, in a sentence or two.");

export const CARD_TEMPLATES: CardTemplate[] = [
  // ---- characters ----
  {
    id: "character.person",
    kind: "character",
    label: "Person",
    description: "Someone the story can meet: a local, a rival, a friend.",
    role: "npc",
    fields: [
      KIND,
      AGE,
      f("position", "Position", "Their place, job or standing in the world."),
      APPEARANCE,
      MANNER,
      VOICE,
      f("mannerisms", "Mannerisms", "Small habits that make them recognisable on the page."),
      WANTS,
      SECRETS,
      RELATIONS,
      HISTORY,
      f("offscreen", "Life outside the story", "What they do when the player is not around."),
    ],
  },
  {
    id: "character.creature",
    kind: "character",
    label: "Creature",
    description: "An animal, monster or spirit that acts on its own.",
    fields: [
      KIND,
      APPEARANCE,
      f("behaviour", "Behaviour", "What it does, and what sets it off."),
      f("temperament", "Temperament", "Its mood when left alone, and when pushed."),
      f("sounds", "Sounds and signs", "How it is heard, smelled or tracked."),
      f("abilities", "Abilities", "What it can do that people cannot."),
      f("weaknesses", "Weaknesses", "What stops, soothes or harms it."),
      f("keeper", "Keeper or owner", "Who looks after it, hunts it or fears it."),
      SECRETS,
    ],
  },
  {
    id: "character.power",
    kind: "character",
    label: "Deity or being of power",
    description: "A god, a ruler or something older: someone whose will shapes the world.",
    fields: [
      KIND,
      f("domain", "Domain", "What it holds sway over."),
      f("standing", "Standing", "Where it ranks among its peers, and how the world regards it."),
      APPEARANCE,
      MANNER,
      VOICE,
      f("followers", "Followers", "Who serves, worships or fears it."),
      f("rites", "Rites and offerings", "What it asks for, and what happens without it."),
      RELATIONS,
      SECRETS,
      HISTORY,
    ],
  },
  {
    id: "character.player",
    kind: "character",
    label: "Player character",
    description: "A starting character a player can take on.",
    role: "player-template",
    fields: [
      KIND,
      AGE,
      APPEARANCE,
      f("background", "Background", "Where they come from and what shaped them."),
      f("skills", "Skills", "What they are good at."),
      f("gear", "Gear", "What they carry."),
      f("goals", "Goals", "What they want from the story."),
      RELATIONS,
    ],
  },

  // ---- places ----
  {
    id: "place.location",
    kind: "place",
    label: "Location",
    description: "A place the story visits: a harbour, a street, a ruin.",
    fields: [
      f("kind", "Kind", "A harbour town, a ruined chapel, a night market…"),
      f("look", "Look and feel", "What a visitor sees, hears and smells first."),
      f("people", "Who is here", "Who is usually found here, and what they are doing."),
      f("exits", "Exits and connections", "Where it leads, and how far it is."),
      CUSTOMS,
      HISTORY,
      SECRETS,
      HOOKS,
    ],
  },
  {
    id: "place.venue",
    kind: "place",
    label: "Venue or establishment",
    description: "A place that is run by someone: an inn, a shop, a court, a club.",
    fields: [
      f("kind", "Kind", "An inn, a bathhouse, a market hall…"),
      f("keeper", "Keeper or owner", "Who runs it, and how they run it."),
      f("layout", "The ground", "Its rooms or sections, and how people move through them."),
      f("hours", "When it is open", "Hours, seasons, and who is let in."),
      f("patrons", "Who comes", "The regulars and the passers-by."),
      f("staff", "Staff", "Who works here, and under what terms."),
      CUSTOMS,
      SECRETS,
      HOOKS,
    ],
  },
  {
    id: "place.region",
    kind: "place",
    label: "Region or realm",
    description: "A large area: a coast, a kingdom, a mountain range.",
    fields: [
      f("kind", "Kind", "Coast, desert, city-state, borderland…"),
      f("land", "The land", "Its shape, climate and what grows or lives there."),
      f("inhabitants", "Who lives here", "The peoples and how they live."),
      f("rulers", "Who rules", "Who holds power and how it is held."),
      f("places", "Places of note", "Towns, landmarks and borders worth naming."),
      CUSTOMS,
      HISTORY,
      HOOKS,
    ],
  },

  // ---- lore ----
  {
    id: "lore.concept",
    kind: "lore",
    label: "Concept or custom",
    description: "How something in the world works: magic, money, a ritual, a law.",
    fields: [
      WHAT,
      f("origin", "Where it came from", "How it began, and who says so."),
      f("works", "How it works", "The rules of it, step by step where that helps."),
      f("affects", "Who it touches", "Who uses it, who suffers it, who is exempt."),
      f("exceptions", "Exceptions", "Where it fails or does not apply."),
      f("tells", "How it shows in the story", "What the reader should notice when it is at work."),
    ],
  },
  {
    id: "lore.group",
    kind: "lore",
    label: "Group or faction",
    description: "An organisation, family, guild or movement.",
    fields: [
      WHAT,
      f("aims", "What they want", "Their goals, stated and real."),
      f("members", "Members", "Who belongs, and who leads."),
      f("methods", "How they act", "What they do to get it, and what they will not do."),
      f("rivals", "Allies and rivals", "Who they work with and against."),
      SECRETS,
    ],
  },
  {
    id: "lore.kind",
    kind: "lore",
    label: "Species or kind",
    description: "A people, a creature type or a class of being.",
    fields: [
      WHAT,
      f("traits", "Traits", "What they share in body and temperament."),
      f("life", "How they live", "Homes, lifespans, food, families."),
      f("abilities", "Abilities", "What sets them apart."),
      f("others", "How others see them", "Their standing among other kinds."),
      CUSTOMS,
    ],
  },
  {
    id: "lore.event",
    kind: "lore",
    label: "Event or era",
    description: "Something that happened, or a stretch of time with a character of its own.",
    fields: [
      f("when", "When", "Roughly when, and for how long."),
      f("happened", "What happened", "The events in order."),
      f("causes", "Causes", "What led to it."),
      f("consequences", "Consequences", "What is different afterwards."),
      f(
        "remembered",
        "How it is remembered",
        "The version people tell, and the truth if it differs.",
      ),
    ],
  },

  // ---- rules, arcs, scenes ----
  {
    id: "rule.rule",
    kind: "rule",
    label: "Rule",
    description: "A constraint the storyteller must keep.",
    fields: [
      f("rule", "Rule", "State the constraint in one sentence."),
      f("check", "Check", "A yes/no question a judge can answer about a piece of text."),
      f("why", "Why", "The reason this world needs it."),
    ],
  },
  {
    id: "arc.arc",
    kind: "arc",
    label: "Story arc",
    description: "A line of story that can be begun from, or that runs through the world.",
    fields: [
      f("premise", "Premise", "What this story is about."),
      f("opening", "Opening situation", "Where it begins, and who the player is."),
      f("cast", "Who is involved", "The people and powers that matter."),
      f("beats", "Beats", "The turns it is likely to take, in order."),
      f("stakes", "Stakes", "What can be won or lost."),
      f("endings", "Possible endings", "Where it can end up."),
      f("progress", "What has happened so far", "Kept up to date as the story runs."),
    ],
  },
  {
    id: "scene.scene",
    kind: "scene",
    label: "Scene",
    description: "One event, set up to be played or to be referred to.",
    fields: [
      f("setting", "Setting", "Where and when."),
      f("present", "Who is there", "Everyone present, and what they want."),
      f("happens", "What happens", "The event, as it will unfold if left alone."),
      f("outcome", "Outcome", "What changes afterwards."),
    ],
  },
];

/** Every kind also has a blank to write freely in: only the body, no named parts. */
for (const kind of ["lore", "character", "place", "rule", "arc", "scene"] as const) {
  CARD_TEMPLATES.push({
    id: `${kind}.blank`,
    kind,
    label: "Plain notes",
    description: "No named parts: just write.",
    fields: [],
  });
}

const LABELS = new Map<string, string>();
for (const t of CARD_TEMPLATES)
  for (const x of t.fields) if (!LABELS.has(x.id)) LABELS.set(x.id, x.label);

/** The words a field is shown under: the template's label, or the name made readable. */
export function fieldLabel(id: string): string {
  const known = LABELS.get(id);
  if (known) return known;
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const templatesFor = (kind: CardKind): CardTemplate[] =>
  CARD_TEMPLATES.filter((t) => t.kind === kind);

/**
 * The template whose parts best match the fields a card already has (so editing a card offers its
 * own shape), or the kind's first template when it has none.
 */
export function templateFor(kind: CardKind, fieldIds: readonly string[]): CardTemplate {
  const options = templatesFor(kind);
  const filled = new Set(fieldIds);
  let best = options[0] as CardTemplate;
  let score = -1;
  for (const t of options) {
    const hit = t.fields.filter((x) => filled.has(x.id)).length;
    // a card with no fields at all is plain notes; otherwise the most parts in common wins
    const value = filled.size === 0 ? (t.fields.length === 0 ? 1 : 0) : hit;
    if (value > score) {
      best = t;
      score = value;
    }
  }
  return best;
}
