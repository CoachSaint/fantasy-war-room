export type CoachAction = {
  kind: string;
  headline: string;
  freshUntil: string;
  evidenceIds: string[];
};

export type CoachEvidence = { id: string; source: string; summary: string; observedAt: string };
export type CoachChange = { kind: string; headline: string };

function actionReply(action: CoachAction | undefined, label: string, evidence: CoachEvidence[]): string {
  if (!action) return `I do not have a current, evidence-backed ${label} decision for this league. Refresh the league and Scout inputs before acting.`;
  const linked = evidence.filter((item) => action.evidenceIds.includes(item.id)).slice(0, 2);
  const proof = linked.length ? ` Evidence: ${linked.map((item) => `${item.source} — ${item.summary}`).join("; ")}.`
    : " The linked evidence summary is unavailable, so verify the recommendation card before acting.";
  return `${action.headline}. Valid until ${new Date(action.freshUntil).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central.${proof} The score is a heuristic, not a measured win probability.`;
}

/** Return a limited factual answer, or null when the question needs richer context. */
export function answerCoachFromDecisions(
  question: string,
  actions: CoachAction[],
  evidence: CoachEvidence[],
  changes: CoachChange[] | null,
): string | null {
  const q = question.toLowerCase();
  if (/\b(changed|changes|since yesterday|what.s new)\b/.test(q)) {
    if (changes === null) return "I do not have a current comparison baseline for this league yet. Run a fresh Scout update first.";
    if (!changes.length) return "The current decision brief shows no new or changed evidence-backed actions since its previous baseline.";
    return `Current decision changes: ${changes.slice(0, 3).map((change) => `${change.kind.replaceAll("_", " ")}: ${change.headline}`).join("; ")}. This covers materialized actions, not every injury or news update.`;
  }
  if (/\b(waiver|add|drop|pick.?up)\b/.test(q)) {
    if (/\b(qb|rb|wr|te)\b/.test(q)) return null;
    return actionReply(actions.find((action) => action.kind === "add"), "add/drop", evidence);
  }
  if (/\b(start|sit|lineup)\b/.test(q)) {
    if (/\b(flex|qb|rb|wr|te)\b/.test(q)) return null;
    return actionReply(actions.find((action) => action.kind === "start"), "start/sit", evidence);
  }
  if (/\b(draft|best pick)\b/.test(q)) {
    return actionReply(actions.find((action) => action.kind === "draft"), "draft", evidence);
  }
  if (/\b(why|explain|rationale)\b/.test(q)) {
    return actionReply(actions[0], "explanation", evidence);
  }
  return null;
}
