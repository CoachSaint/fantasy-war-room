export interface BriefAction {
  recommendationId: string;
  kind: string;
  subjectPlayerId: string;
  alternativePlayerId: string | null;
  score: number;
  headline: string;
  evidenceIds: string[];
  computedAt: string;
}

export type BriefChange =
  | { kind: "new_action"; action: BriefAction }
  | { kind: "removed_action"; action: BriefAction }
  | { kind: "priority_changed"; action: BriefAction; previousScore: number };

function actionKey(action: BriefAction): string {
  return `${action.kind}:${action.subjectPlayerId}:${action.alternativePlayerId || ""}`;
}

/** Compare stable decision identities, not regenerated recommendation row IDs. */
export function diffBriefActions(previous: BriefAction[], current: BriefAction[]): BriefChange[] {
  const before = new Map(previous.map((action) => [actionKey(action), action]));
  const after = new Map(current.map((action) => [actionKey(action), action]));
  const changes: BriefChange[] = [];
  for (const [key, action] of after) {
    const old = before.get(key);
    if (!old) changes.push({ kind: "new_action", action });
    else if (old.score !== action.score) changes.push({ kind: "priority_changed", action, previousScore: old.score });
  }
  for (const [key, action] of before) {
    if (!after.has(key)) changes.push({ kind: "removed_action", action });
  }
  return changes.sort((a, b) => b.action.score - a.action.score);
}
