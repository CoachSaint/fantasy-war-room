import { describe, expect, it } from "vitest";
import { diffBriefActions, type BriefAction } from "../src/lib/engine/daily-brief";

function action(id: string, subjectPlayerId: string, score: number): BriefAction {
  return { recommendationId: id, kind: "start", subjectPlayerId, alternativePlayerId: null,
    score, headline: `Start ${subjectPlayerId}`, evidenceIds: ["source-1"], computedAt: "2026-09-24T12:00:00Z" };
}

describe("daily brief recommendation delta", () => {
  it("ignores regenerated row IDs and reports only real decision changes", () => {
    const previous = [action("old-a", "a", 70), action("old-b", "b", 61), action("old-c", "c", 55)];
    const current = [action("new-a", "a", 70), action("new-b", "b", 65), action("new-d", "d", 80)];
    expect(diffBriefActions(previous, current)).toEqual([
      { kind: "new_action", action: current[2] },
      { kind: "priority_changed", action: current[1], previousScore: 61 },
      { kind: "removed_action", action: previous[2] },
    ]);
  });
});
