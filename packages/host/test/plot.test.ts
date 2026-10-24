import type { BuiltContext, Card, PlotPoint, Turn } from "@nirmata/core";
import { describe, expect, it } from "vitest";
import { candidateCards, HostError, parsePlot, plotMessages } from "../src";
import { loadWorld } from "./helpers";

const { cards } = loadWorld("example-world");
const turn = (text: string, role: "player" | "host" = "host", id = text): Turn => ({
  id,
  role,
  ...(role === "player" ? { mode: "do" as const } : {}),
  text,
});
const ids = (cs: readonly Card[]) => cs.map((c) => c.fm.id);
const point = (card: string, text: string, i = 0): PlotPoint => ({
  id: `e:${i}`,
  card,
  text,
  eventId: "e",
});

describe("candidateCards", () => {
  it("offers cards the recent turns mention by name or keyword, plus every arc", () => {
    expect(ids(candidateCards(cards, [turn("Marrow lit the lamp.")]))).toEqual([
      "arc.fourth-light",
      "char.marrow",
    ]);
    expect(ids(candidateCards(cards, [turn("Thick mist rolled in.")]))).toEqual([
      "arc.fourth-light",
      "lore.the-fog",
    ]);
  });

  it("never offers rules or authored scene notes, and offers only arcs when nothing is mentioned", () => {
    expect(ids(candidateCards(cards, [turn("Nothing relevant.")]))).toEqual(["arc.fourth-light"]);
    const scene = {
      ...cards[0],
      fm: { ...(cards[0] as Card).fm, id: "scene.beat", kind: "scene", keywords: ["beat"] },
    } as Card;
    expect(ids(candidateCards([...cards, scene], [turn("beat")]))).not.toContain("scene.beat");
  });

  it("also offers cards that were in the last prompt", () => {
    const context = {
      included: [
        { section: "lore", id: "place.saltmere", label: "x", reason: "r", tokens: 1 },
        { section: "history", id: "turn-1", label: "x", reason: "r", tokens: 1 },
      ],
    } as unknown as BuiltContext;
    expect(ids(candidateCards(cards, [turn("Nothing relevant.")], context))).toEqual([
      "arc.fourth-light",
      "place.saltmere",
    ]);
  });

  it("is capped and in a stable order", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...(cards[1] as Card),
      fm: {
        ...(cards[1] as Card).fm,
        id: `lore.c${String(i).padStart(2, "0")}`,
        name: `Thing${i}`,
        keywords: [`thing${i}`],
      },
    })) as Card[];
    const text = many.map((c) => c.fm.name).join(" ");
    const out = candidateCards(many, [turn(text)]);
    expect(out).toHaveLength(40);
    expect(ids(out)).toEqual([...ids(out)].sort());
  });
});

describe("plotMessages", () => {
  it("shows the extractor only ids, names and kinds, never summaries or bodies", () => {
    const candidates = candidateCards(cards, [turn("Marrow")]);
    const [system, user] = plotMessages([turn("Marrow lit the lamp.")], candidates, [], 6);
    expect(system?.content).toContain("at most 6 points");
    expect(user?.content).toContain("- char.marrow: Marrow (character)");
    expect(user?.content).not.toContain("Gruff keeper"); // marrow's summary
    expect(user?.content).not.toContain("himself"); // marrow's secret
    expect(user?.content).toContain("<known_points>\n(none)\n</known_points>");
  });

  it("includes only the newest few known points for offered cards", () => {
    const candidates = candidateCards(cards, [turn("Marrow")]);
    const known = [
      ...Array.from({ length: 5 }, (_, i) => point("char.marrow", `marrow ${i}`, i)),
      point("place.saltmere", "not offered", 9),
    ];
    const user = plotMessages([turn("x")], candidates, known, 6)[1]?.content ?? "";
    expect(user).toContain(
      "- char.marrow: marrow 2\n- char.marrow: marrow 3\n- char.marrow: marrow 4",
    );
    expect(user).not.toContain("marrow 1");
    expect(user).not.toContain("not offered");
  });

  it("labels who said what", () => {
    const user =
      plotMessages([turn("I knock.", "player", "p"), turn("It opens.")], [], [], 3)[1]?.content ??
      "";
    expect(user).toContain("Player (do): I knock.\n\nHost: It opens.");
  });
});

describe("parsePlot", () => {
  const candidates = cards.filter((c) => ["char.marrow", "arc.fourth-light"].includes(c.fm.id));
  const answer = (points: unknown) => JSON.stringify({ points });

  it("keeps points for offered cards and drops the rest", () => {
    const out = parsePlot(
      answer([
        { card: "char.marrow", text: "  Marrow opened   the door. " },
        { card: "place.saltmere", text: "Not offered." },
        { card: "char.marrow", text: 42 },
        { text: "No card." },
        "junk",
      ]),
      candidates,
      [],
      6,
    );
    expect(out).toEqual([{ card: "char.marrow", text: "Marrow opened the door." }]);
  });

  it("drops repeats of known points and of itself, ignoring case and spacing", () => {
    const out = parsePlot(
      answer([
        { card: "char.marrow", text: "Marrow opened the door." },
        { card: "char.marrow", text: "marrow  OPENED the door." },
        { card: "arc.fourth-light", text: "The light was seen." },
      ]),
      candidates,
      [point("char.marrow", "Marrow opened the door.")],
      6,
    );
    expect(out).toEqual([{ card: "arc.fourth-light", text: "The light was seen." }]);
  });

  it("caps the number and the length of points", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ card: "char.marrow", text: `point ${i}` }));
    expect(parsePlot(answer(many), candidates, [], 3)).toHaveLength(3);
    const long = parsePlot(
      answer([{ card: "char.marrow", text: "x".repeat(500) }]),
      candidates,
      [],
      3,
    );
    expect(long[0]?.text).toHaveLength(240);
  });

  it("reads fenced JSON and an empty list", () => {
    expect(parsePlot('```json\n{"points":[]}\n```', candidates, [], 3)).toEqual([]);
  });

  it("throws only when the answer is unreadable", () => {
    for (const bad of ["no json", "{oops}", '{"other":[]}', '{"points":"x"}']) {
      expect(() => parsePlot(bad, candidates, [], 3)).toThrow(HostError);
    }
  });
});
