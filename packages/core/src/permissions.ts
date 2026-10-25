/**
 * Who may do what (ADR-0009). Two roles:
 * - `host`: whoever runs the story or owns the world. In solo play that is the player too.
 * - `player`: everyone else taking part.
 * The caller (the server) decides who holds which role; this module only answers questions.
 */
export type Role = "host" | "player";

export interface Actor {
  id: string;
  role: Role;
}

/** The one table. The first row is a rule from the owner; the rest are defaults to adjust. */
const ALLOWED = {
  /** Edit or remove the world's source cards. Never a player. */
  "source.edit": ["host"],
  /** Take the copy of the source cards and begin a story. */
  "story.start": ["host"],
  "story.play": ["host", "player"],
  "story.undo": ["host", "player"],
  "story.edit-turn": ["host", "player"],
  "story.pin": ["host", "player"],
  /** Jump to another branch of the story. */
  "story.branch": ["host"],
  "plot.extract": ["host"],
  "plot.add": ["host"],
  "plot.revoke": ["host"],
  "chapter.break": ["host"],
  "settings.change": ["host"],
  /** Kick, mute or rename someone at the table, and close a round early. */
  "board.moderate": ["host"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ALLOWED;
export const ACTIONS = Object.keys(ALLOWED) as Action[];

const REFUSAL: Record<Action, string> = {
  "source.edit": "Only the host can edit the source cards.",
  "story.start": "Only the host can start a story.",
  "story.play": "You can't take part in this story.",
  "story.undo": "You can't undo in this story.",
  "story.edit-turn": "You can't edit turns in this story.",
  "story.pin": "You can't pin facts in this story.",
  "story.branch": "Only the host can jump to another branch of the story.",
  "plot.extract": "Only the host can update plot points.",
  "plot.add": "Only the host can add plot points.",
  "plot.revoke": "Only the host can take back plot points.",
  "chapter.break": "Only the host can start a new chapter.",
  "settings.change": "Only the host can change settings.",
  "board.moderate": "Only the host can wield that power.",
};

export function can(actor: Actor, action: Action): boolean {
  return (ALLOWED[action] as readonly Role[]).includes(actor.role);
}

export class PermissionError extends Error {
  constructor(
    readonly action: Action,
    readonly role: Role,
  ) {
    super(REFUSAL[action]);
    this.name = "PermissionError";
  }
}

/** Throws a PermissionError, whose message is safe to show the player, unless `actor` may. */
export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw new PermissionError(action, actor.role);
}
