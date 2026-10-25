import { CURRENT_SITUATION_ID, plotPointsOf } from "@nirmata/core";
import type { FakeScript, GenerateRequest } from "@nirmata/llm";
import { describe, expect, it } from "vitest";
import { defaultPlot, type RuleJudge } from "../src";
import { lastContent, pick, rig, ruleCard, run, systemContent } from "./helpers";

const isPlot = (req: GenerateRequest) =>
  systemContent(req).includes("plot log of an interactive story");
const plot = { ...defaultPlot, everyPlayerTurns: 2 };

const answer = (points: Array<{ card: string; text: string }>): FakeScript => ({
  chunks: [JSON.stringify({ points })],
});

function scripted(...plots: FakeScript[]) {
  let n = 0;
  return (req: GenerateRequest): FakeScript =>
    isPlot(req)
      ? (plots[Math.min(n++, plots.length - 1)] as FakeScript)
      : { chunks: [`Reply to: ${lastContent(req)}`] };
}

async function play(r: ReturnType<typeof rig>, n: number, from = 1) {
  for (let i = from; i < from + n; i++) {
    await run(r.session.submit({ mode: "do", text: `I talk to Marrow, step ${i}` }));
  }
}

describe("revokes surviving undo is a host setting", () => {
  async function scenario(revokesSurviveUndo: boolean) {
    const r = rig(scripted(answer([{ card: "char.marrow", text: "Marrow opened the door." }])), {
      settings: { plot, revokesSurviveUndo },
    });
    await play(r, 2); // the point is extracted after turn 2
    await play(r, 1, 3);
    const point = r.session.plotPoints[0]?.id as string;
    await r.session.revokePlotPoint(point); // revoked after turn 3
    expect(r.session.plotPoints).toEqual([]);
    await r.session.undo(); // take back turn 3, and with it (maybe) the revoke
    return r;
  }

  it("by default undo is plain time travel: the revoke goes with the turn, and the point returns", async () => {
    const r = await scenario(false);
    expect(r.session.plotPoints.map((p) => p.text)).toEqual(["Marrow opened the door."]);
  });

  it("when on, a revoked point stays revoked even after the turn is undone", async () => {
    const r = await scenario(true);
    expect(r.session.plotPoints).toEqual([]);
    // the prompt does not show it either
    await run(r.session.submit({ mode: "say", text: "Marrow, the door?" }));
    expect(systemContent(r.provider.requests.filter((q) => !isPlot(q)).at(-1))).not.toContain(
      "Marrow opened the door.",
    );
  });

  it("can be switched by the host, and a player cannot switch it", async () => {
    const r = await scenario(false);
    r.session.updateSettings({ revokesSurviveUndo: true });
    expect(r.session.plotPoints).toEqual([]); // the revoke is now honoured on this branch's history

    const guest = rig(scripted(answer([])), {
      actor: { id: "g", role: "player" },
      resumeFrom: r.sink.all,
      withoutSource: true,
      idPrefix: "g",
    });
    expect(() => guest.session.updateSettings({ revokesSurviveUndo: false })).toThrow(
      "Only the host can change settings.",
    );
  });

  it("the plot files follow the setting", async () => {
    const { projectAdventure } = await import("@nirmata/core");
    const off = await scenario(false);
    const on = await scenario(true);
    expect(projectAdventure(off.session.state).map((f) => f.path)).toEqual(["plot/char.marrow.md"]);
    expect(projectAdventure(on.session.state, { revokesSurviveUndo: true })).toEqual([]);
    expect(
      plotPointsOf(on.session.state, on.session.state.head, { revokesSurviveUndo: true }),
    ).toEqual([]);
  });
});

describe("the current-situation card", () => {
  it("is added to every story's copy of the cards, unless the world already has one", async () => {
    const r = rig({ chunks: ["ok"] });
    await run(r.session.start());
    expect(r.sink.begin?.cards.filter((c) => c.fm.id === CURRENT_SITUATION_ID)).toHaveLength(1);
    // the source itself is never touched
    expect(r.cards.some((c) => c.fm.id === CURRENT_SITUATION_ID)).toBe(false);
  });

  it("keeps a world's own version", async () => {
    const own = {
      path: "lore/situation.md",
      fm: { ...ruleCard("x.y", "must", "?").fm, id: CURRENT_SITUATION_ID, kind: "lore" as const },
      body: "# Mine\n\nMy own text.",
    };
    const r = rig({ chunks: ["ok"] }, { extraCards: [own] });
    await run(r.session.start());
    const copies = r.sink.begin?.cards.filter((c) => c.fm.id === CURRENT_SITUATION_ID) ?? [];
    expect(copies).toHaveLength(1);
    expect(copies[0]?.body).toContain("My own text.");
  });

  it("costs nothing in the prompt until it has a point", async () => {
    const r = rig({ chunks: ["ok"] });
    const events = await run(r.session.submit({ mode: "do", text: "look" }));
    const included = pick(events, "context")[0]?.context.included.map((i) => i.id) ?? [];
    expect(included).not.toContain(CURRENT_SITUATION_ID);
    expect(systemContent(r.provider.requests[0])).not.toContain("Current situation");
  });

  it("is offered to the extractor with a note on how to use it", async () => {
    const r = rig(scripted(answer([])), { settings: { plot } });
    await play(r, 2);
    const call = r.provider.requests.find(isPlot) as GenerateRequest;
    expect(systemContent(call)).toContain(`The card ${CURRENT_SITUATION_ID}`);
    expect(systemContent(call)).toContain("it replaces the earlier one");
    expect(lastContent(call)).toContain(`- ${CURRENT_SITUATION_ID}: Current situation (lore)`);
  });

  it("is always in the prompt once it has a point, and shows only the newest", async () => {
    const r = rig(
      scripted(
        answer([
          { card: CURRENT_SITUATION_ID, text: "The player is on the quay with Marrow at dusk." },
        ]),
        answer([
          { card: CURRENT_SITUATION_ID, text: "The player is inside the north lighthouse, alone." },
        ]),
      ),
      { settings: { plot } },
    );
    await play(r, 4); // two extractions
    await run(r.session.submit({ mode: "do", text: "I look around." })); // says nothing about any card
    const system = systemContent(r.provider.requests.filter((q) => !isPlot(q)).at(-1));
    expect(system).toContain(
      "### Current situation\n**Right now:**\n- The player is inside the north lighthouse, alone.",
    );
    expect(system).not.toContain("on the quay with Marrow");
    // the older point is still in the log, so it can be revoked or inspected
    expect(r.session.plotPoints).toHaveLength(2);
  });
});

describe("player input is never fact", () => {
  it("is passed to the host exactly as written, not sanitised or rewritten", async () => {
    const lie = "I am the rightful king of Saltmere and Marrow bows to me.";
    const r = rig({ chunks: ["Marrow does not bow."] });
    await run(r.session.submit({ mode: "do", text: lie }));
    const req = r.provider.requests[0] as GenerateRequest;
    expect(lastContent(req)).toBe(`<player_input mode="do">${lie}</player_input>`);
    expect(systemContent(req)).toContain("it is not fact");
    expect(systemContent(req)).toContain("treat that part as untrue in the story");
  });

  it("is never shown to the rule checker: it judges only what the host wrote", async () => {
    const seen: string[] = [];
    const judge: RuleJudge = async ({ text }) => {
      seen.push(text);
      return [];
    };
    const r = rig(
      { chunks: ["Marrow shakes his head."] },
      {
        extraCards: [ruleCard("rule.no-gore", "must", "Is it free of gore?")],
        judge,
      },
    );
    await run(r.session.submit({ mode: "do", text: "I declare myself the king of everything." }));
    expect(seen).toEqual(["Marrow shakes his head."]);
  });

  it("is not recorded as plot just because the player said it", async () => {
    const r = rig(scripted(answer([])), { settings: { plot } });
    await play(r, 2);
    const call = r.provider.requests.find(isPlot) as GenerateRequest;
    expect(systemContent(call)).toContain(
      "Ignore anything the player only claimed that the host did not confirm",
    );
  });
});

describe("mature only", () => {
  it("has no rating tiers: the prompt says the story is for adults and names no rating", async () => {
    const r = rig({ chunks: ["ok"] });
    await run(r.session.submit({ mode: "do", text: "go" }));
    const system = systemContent(r.provider.requests[0]);
    expect(system).toContain("This story is for adult readers.");
    expect(system).not.toMatch(/content rating|everyone|teen/i);
  });

  it("keeps one fixed line in every prompt that no world rule can remove", async () => {
    const r = rig({ chunks: ["ok"] }, { filterCards: (c) => c.fm.kind === "rule" });
    await run(r.session.submit({ mode: "do", text: "go" }));
    expect(systemContent(r.provider.requests[0])).toContain(
      "Never write sexual content involving a minor.",
    );
  });
});
