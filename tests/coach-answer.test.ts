import { describe, expect, it } from "vitest";
import { answerCoachFromDecisions } from "../src/lib/engine/coach-answer";

const actions = [
  { kind: "start", headline: "Start Bench Runner over Starter Runner (forecast edge 5 points)",
    freshUntil: "2030-09-25T18:00:00.000Z", evidenceIds: ["projection-1"] },
  { kind: "add", headline: "Consider adding Available Runner and dropping Bench Runner",
    freshUntil: "2030-09-25T18:00:00.000Z", evidenceIds: ["projection-2"] },
];
const evidence = [
  { id: "projection-1", source: "sleeper_weekly_projections", summary: "Week 3 source-matched projection", observedAt: "2030-09-25T12:00:00.000Z" },
];

describe("Coach's structured answer boundary", () => {
  it("answers broad start questions from linked evidence without a probability claim", () => {
    const reply = answerCoachFromDecisions("Who should I start?", actions, evidence, null);
    expect(reply).toContain("Start Bench Runner over Starter Runner");
    expect(reply).toContain("sleeper_weekly_projections");
    expect(reply).toContain("not a measured win probability");
  });

  it("does not invent position-specific eligibility or an absent draft pick", () => {
    expect(answerCoachFromDecisions("Who should I start at FLEX?", actions, evidence, null)).toBeNull();
    expect(answerCoachFromDecisions("Best waiver TE available?", actions, evidence, null)).toBeNull();
    expect(answerCoachFromDecisions("Who should I draft?", actions, evidence, null)).toContain("do not have a current");
  });

  it("distinguishes a missing comparison baseline from zero changes", () => {
    expect(answerCoachFromDecisions("What changed since yesterday?", actions, evidence, null)).toContain("do not have a current comparison baseline");
    expect(answerCoachFromDecisions("What changed since yesterday?", actions, evidence, [])).toContain("no new or changed");
    expect(answerCoachFromDecisions("What changed since yesterday?", actions, evidence,
      [{ kind: "new_action", headline: "Start Bench Runner" }])).toContain("new action: Start Bench Runner");
  });
});
