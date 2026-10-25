/**
 * Moderation at the table is told as part of the story (ADR-0015): a hush-spell, a strip of tape,
 * a halberd, a trapdoor. The words are flavour; the effect (silenced, removed, renamed) is plain
 * state that the interface shows separately.
 */
export type FlavorStyle = "spell" | "tape" | "weapon" | "trap";
export type ModerationAction = "kick" | "mute" | "unmute" | "rename";

export const FLAVOR_STYLES: readonly FlavorStyle[] = ["spell", "tape", "weapon", "trap"];

export interface FlavorVars {
  host: string;
  target: string;
  newName?: string | undefined;
}

const TEMPLATES: Record<ModerationAction, Record<FlavorStyle, readonly string[]>> = {
  kick: {
    spell: [
      "A banishing sigil flares under {target}'s feet, and with a pop of sulphur they are whisked out of the room.",
      "{host} speaks a word of leaving; the door swings wide and an unseen wind sweeps {target} through it.",
    ],
    tape: [
      "{host} snaps out a roll of heavy tape and mummifies {target}, who is carried out like a parcel.",
      "A strip of tape as long as the hall wraps {target} snugly; with a tug from {host}, out they go.",
    ],
    weapon: [
      "{host}'s halberd hooks {target} by the collar, and the guards haul them out of the room.",
      "A net flung by {host} tangles {target}, and they are dragged to the door.",
    ],
    trap: [
      "The floor beneath {target} gives way with a clack of hidden hinges, and they drop out of sight.",
      "{host} pulls a lever; the chair under {target} shoots up the chimney.",
    ],
  },
  mute: {
    spell: [
      "{host} breathes out a hush-spell; {target}'s voice folds up like paper and goes quiet.",
      "A spell of stillness settles on {target}'s tongue.",
    ],
    tape: [
      "A strip of black tape seals {target}'s mouth.",
      "{host} presses a neat length of tape across {target}'s lips.",
    ],
    weapon: [
      "{host}'s gauntlet clamps gently over {target}'s mouth.",
      "{host} lays the flat of a sword across {target}'s lips, and {target} knows to say no more.",
    ],
    trap: [
      "A velvet muzzle drops from the rafters and snaps shut over {target}'s mouth.",
      "A curtain on a spring whisks around {target}, muffling every word.",
    ],
  },
  unmute: {
    spell: [
      "The hush lifts from {target}, and their voice returns.",
      "{host} snaps a finger; the stillness on {target}'s tongue melts away.",
    ],
    tape: [
      "The tape peels away from {target}'s mouth with a rip.",
      "{host} lifts the tape from {target}'s lips, and they may speak again.",
    ],
    weapon: [
      "{host} lifts the gauntlet from {target}'s mouth.",
      "The sword-flat leaves {target}'s lips, and they may speak again.",
    ],
    trap: [
      "The muzzle clicks open and drops away from {target}.",
      "The curtain whips back, and {target} can be heard again.",
    ],
  },
  rename: {
    spell: [
      "A naming-charm crackles over the table: {target} is now called {newName}.",
      "{host} chalks a rune in the air, and {target} answers to {newName} from now on.",
    ],
    tape: [
      "{host} slaps a fresh strip of tape across {target}'s badge and scrawls {newName} on it.",
      "A new label is taped over {target}'s old one: {newName}.",
    ],
    weapon: [
      "{host} chisels a new name into {target}'s shield: {newName}.",
      "{host}'s dagger scratches {newName} over {target}'s old name on the table.",
    ],
    trap: [
      "A trick-lock clicks and {target}'s name-plate spins around to read {newName}.",
      "A hidden panel flips on {target}'s seat; the name on it now says {newName}.",
    ],
  },
};

/**
 * The in-fiction line for a moderation action. `variant` picks the wording deterministically, so
 * the same inputs always give the same line.
 */
export function describeModeration(
  action: ModerationAction,
  style: FlavorStyle,
  vars: FlavorVars,
  variant = 0,
): string {
  const options = TEMPLATES[action][style];
  const template = options[variant % options.length] as string;
  return template
    .replaceAll("{host}", vars.host)
    .replaceAll("{target}", vars.target)
    .replaceAll("{newName}", vars.newName ?? "");
}
