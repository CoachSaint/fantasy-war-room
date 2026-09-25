"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { YahooConnectionCard } from "@/components/yahoo-connection-card";
import type { Position, ScoringPreset, RosterSlotType } from "@/lib/types";

type CoefficientGroup = Record<string, number>;
type ScoringForm = { preset: ScoringPreset; passing: CoefficientGroup; rushing: CoefficientGroup; receiving: CoefficientGroup; misc: CoefficientGroup };
type TeamForm = { id: string; name: string; managerId: string; managerName: string };
type SlotForm = { slotType: RosterSlotType; count: number; required: boolean };

const positions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
const slotTypes: RosterSlotType[] = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "WR_RB", "WR_TE", "K", "DST", "BENCH", "IR", "TAXI"];
const eligibleBySlot: Record<RosterSlotType, Position[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DST: ["DST"],
  FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"], WR_RB: ["WR", "RB"], WR_TE: ["WR", "TE"],
  BENCH: positions, IR: positions, TAXI: positions,
};
const coefficientLabels: Record<string, string> = {
  passYard: "Passing yards / point", passTd: "Passing TD", interception: "Interception",
  completion: "Completion", incompletion: "Incompletion", twoPoint: "Two-point conversion",
  rushYard: "Rushing yards / point", rushTd: "Rushing TD", firstDown: "First down",
  reception: "Reception", receivingYard: "Receiving yards / point", receivingTd: "Receiving TD",
  fumble: "Fumble", fumbleLost: "Fumble lost", returnYard: "Return yards / point", returnTd: "Return TD",
};
const baseGroups = {
  passing: { passYard: 0.04, passTd: 4, interception: -2, completion: 0, incompletion: 0, twoPoint: 2 },
  rushing: { rushYard: 0.1, rushTd: 6, firstDown: 0, twoPoint: 2 },
  receiving: { reception: 0, receivingYard: 0.1, receivingTd: 6, firstDown: 0, twoPoint: 2 },
  misc: { fumble: -2, fumbleLost: -2, returnYard: 0, returnTd: 6 },
};

function scoringFor(preset: ScoringPreset): ScoringForm {
  const reception = preset === "ppr" ? 1 : preset === "half_ppr" ? 0.5 : 0;
  return {
    preset,
    passing: { ...baseGroups.passing },
    rushing: { ...baseGroups.rushing },
    receiving: { ...baseGroups.receiving, reception },
    misc: { ...baseGroups.misc },
  };
}

const initialTeams: TeamForm[] = [
  { id: "team-1", name: "", managerId: "manager-1", managerName: "" },
  { id: "team-2", name: "", managerId: "manager-2", managerName: "" },
];
const initialSlots: SlotForm[] = [
  { slotType: "QB", count: 1, required: true }, { slotType: "RB", count: 2, required: true },
  { slotType: "WR", count: 2, required: true }, { slotType: "TE", count: 1, required: true },
  { slotType: "FLEX", count: 1, required: true }, { slotType: "BENCH", count: 6, required: false },
];

function fieldLabel(label: string, value: number, onChange: (value: number) => void) {
  return (
    <label style={{ display: "grid", gap: 5, fontSize: 12 }}>
      <span className="muted">{label}</span>
      <input type="number" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ minHeight: 38, width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} />
    </label>
  );
}

export default function LeagueSetupPage() {
  const [basics, setBasics] = useState({ leagueId: "", name: "", season: 2026, week: 1, teamCount: 2, benchSlots: 6, irSlots: 0, taxiSlots: 0 });
  const [scoring, setScoring] = useState<ScoringForm>(scoringFor("half_ppr"));
  const [slots, setSlots] = useState<SlotForm[]>(initialSlots);
  const [teams, setTeams] = useState<TeamForm[]>(initialTeams);
  const [knownPlayerIds, setKnownPlayerIds] = useState("");
  const [assignments, setAssignments] = useState("");
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({ status: "idle" });

  const parsedKnownPlayers = useMemo(() => knownPlayerIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean), [knownPlayerIds]);
  const parsedAssignments = useMemo(() => assignments.split("\n").map((line) => line.split(/[=,]/).map((part) => part.trim())).filter((parts) => parts.length >= 2 && parts[0] && parts[1]).map(([playerId, teamId]) => ({ playerId, teamId })), [assignments]);
  const checks = useMemo(() => {
    const ids = teams.map((team) => team.id.trim());
    const managerIds = teams.map((team) => team.managerId.trim());
    const validBasics = Boolean(basics.leagueId.trim() && basics.name.trim() && basics.teamCount >= 2 && basics.season >= 2000);
    const validTeams = teams.length === basics.teamCount && teams.every((team) => team.id.trim() && team.name.trim()) && new Set(ids).size === ids.length;
    const validMappings = teams.every((team) => team.managerId.trim() && team.managerName.trim()) && new Set(managerIds).size === managerIds.length;
    const validSlots = slots.length > 0 && slots.every((slot) => slot.count > 0);
    return { validBasics, validTeams, validMappings, validSlots, all: validBasics && validTeams && validMappings && validSlots };
  }, [basics, teams, slots]);

  const updateScoring = (group: keyof Omit<ScoringForm, "preset">, key: string, value: number) => {
    setScoring((previous) => ({ ...previous, [group]: { ...previous[group], [key]: value }, preset: "custom" }));
  };

  const updateTeam = (index: number, field: keyof TeamForm, value: string) => {
    setTeams((previous) => previous.map((team, teamIndex) => teamIndex === index ? { ...team, [field]: value } : team));
  };

  const payload = () => ({
    league: basics,
    scoring,
    rosterSlots: slots.map((slot, index) => ({ id: "slot-" + (index + 1), ...slot, slotOrder: index, eligiblePositions: eligibleBySlot[slot.slotType] })),
    teams: teams.map(({ id, name }) => ({ id, name })),
    managers: teams.map(({ managerId, managerName }) => ({ managerId, displayName: managerName })),
    managerMappings: teams.map(({ id, managerId }) => ({ teamId: id, managerId })),
    knownPlayerIds: parsedKnownPlayers,
    playerAssignments: parsedAssignments,
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!checks.all) {
      setSaveState({ status: "error", message: "Complete the required fields and resolve the verification checks before saving." });
      return;
    }
    setSaveState({ status: "saving" });
    try {
      const response = await fetch("/api/leagues/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ managerId: teams[0].managerId.trim(), setup: payload() }),
      });
      const body: unknown = await response.json().catch(() => null);
      const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const error = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : null;
      if (response.status === 401) throw new Error("Sign in is required before league setup can be saved.");
      if (response.status === 503) throw new Error("League setup is unavailable because the server is not configured.");
      if (!response.ok || data.ok === false) {
        const issueList = Array.isArray(data.errors) ? data.errors.map((issue) => typeof issue === "object" && issue && "message" in issue ? String(issue.message) : String(issue)).join(" ") : "";
        throw new Error(error ?? issueList ?? "The server rejected this setup.");
      }
      const result = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : data;
      const fingerprint = typeof result.fingerprint === "string" ? " Setup fingerprint: " + result.fingerprint : "";
      setSaveState({ status: "saved", message: "League setup was accepted by the server." + fingerprint });
    } catch (error) {
      setSaveState({ status: "error", message: error instanceof Error ? error.message : "Setup could not be saved. No local persistence was assumed." });
    }
  };

  return (
    <>
      <ConfigurationBanner message="Setup is the boundary between fixture screens and league-bound workflows. Nothing is treated as live until the server accepts this form." linkLabel="View settings" href="/league/settings" />
      <PageHeader eyebrow="League setup studio" title="Connect the context behind every decision." description="Define league basics, exact scoring coefficients, roster slots, and manager ownership. The server remains authoritative and reports validation or authentication failures." />
      <div style={{ marginBottom: 20 }}><YahooConnectionCard /></div>
      <form className="setup-form" onSubmit={submit} style={{ display: "grid", gap: 20 }}>
        <section className="card" style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>1. League basics</h2>
          <div className="grid grid-3">
            {([["League ID", "leagueId", basics.leagueId], ["League name", "name", basics.name]] as const).map(([label, key, value]) => <label key={key} style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">{label}</span><input required value={value} onChange={(event) => setBasics((previous) => ({ ...previous, [key]: event.target.value }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>)}
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Season</span><input type="number" min={2000} max={2100} value={basics.season} onChange={(event) => setBasics((previous) => ({ ...previous, season: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Current week</span><input type="number" min={0} max={23} value={basics.week} onChange={(event) => setBasics((previous) => ({ ...previous, week: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Team count</span><input type="number" min={2} max={32} value={basics.teamCount} onChange={(event) => setBasics((previous) => ({ ...previous, teamCount: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Bench slots</span><input aria-label="Bench slots" type="number" min={0} max={20} value={basics.benchSlots} onChange={(event) => setBasics((previous) => ({ ...previous, benchSlots: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">IR slots</span><input aria-label="IR slots" type="number" min={0} max={10} value={basics.irSlots} onChange={(event) => setBasics((previous) => ({ ...previous, irSlots: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Taxi slots</span><input aria-label="Taxi slots" type="number" min={0} max={10} value={basics.taxiSlots} onChange={(event) => setBasics((previous) => ({ ...previous, taxiSlots: Number(event.target.value) }))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }} /></label>
          </div>
        </section>

        <section className="card" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2 style={{ margin: 0, fontSize: 20 }}>2. Scoring coefficients</h2><p className="muted" style={{ margin: "5px 0 0", fontSize: 13 }}>Presets are shown with their exact editable coefficients. Change any value to switch to custom.</p></div><select aria-label="Scoring preset" value={scoring.preset} onChange={(event) => setScoring(scoringFor(event.target.value as ScoringPreset))} style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }}><option value="standard">Standard</option><option value="half_ppr">Half PPR</option><option value="ppr">PPR</option><option value="custom">Custom</option></select></div>
          {(["passing", "rushing", "receiving", "misc"] as const).map((group) => <div key={group} style={{ display: "grid", gap: 10 }}><h3 style={{ margin: 0, fontSize: 14, textTransform: "capitalize" }}>{group}</h3><div className="grid grid-3">{Object.entries(scoring[group]).map(([key, value]) => fieldLabel(coefficientLabels[key] ?? key, value, (next) => updateScoring(group, key, next)))}</div></div>)}
        </section>

        <section className="card" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><div><h2 style={{ margin: 0, fontSize: 20 }}>3. Structured roster slots</h2><p className="muted" style={{ margin: "5px 0 0", fontSize: 13 }}>Slot eligibility is derived from the slot type and sent explicitly to the server.</p></div><button type="button" onClick={() => setSlots((previous) => [...previous, { slotType: "FLEX", count: 1, required: true }])} style={{ display: "inline-flex", gap: 5, alignItems: "center", minHeight: 36, borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", padding: "0 12px", fontWeight: 700 }}><Plus size={14} /> Add slot</button></div>
          {slots.map((slot, index) => <div key={index} className="setup-slot-row" style={{ gap: 10, alignItems: "end", padding: 10, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}><label style={{ display: "grid", gap: 4, fontSize: 11 }}><span className="muted">Slot type</span><select value={slot.slotType} onChange={(event) => setSlots((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, slotType: event.target.value as RosterSlotType } : item))} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)" }}>{slotTypes.map((option) => <option key={option}>{option}</option>)}</select></label><label style={{ display: "grid", gap: 4, fontSize: 11 }}><span className="muted">Count</span><input type="number" min={1} max={20} value={slot.count} onChange={(event) => setSlots((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, count: Number(event.target.value) } : item))} style={{ minHeight: 36, width: "100%", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 8px" }} /></label><span className="muted" style={{ fontSize: 12, paddingBottom: 10 }}>Eligible: {eligibleBySlot[slot.slotType].join(", ")}</span><label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, paddingBottom: 10 }}><input type="checkbox" checked={slot.required} disabled={["BENCH", "IR", "TAXI"].includes(slot.slotType)} onChange={(event) => setSlots((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} /> Required</label><button type="button" aria-label="Remove roster slot" onClick={() => setSlots((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} style={{ border: 0, background: "transparent", color: "var(--bad)", paddingBottom: 9 }}><Trash2 size={16} /></button></div>)}
        </section>

        <section className="card" style={{ display: "grid", gap: 14 }}>
          <div><h2 style={{ margin: 0, fontSize: 20 }}>4. Teams and manager mappings</h2><p className="muted" style={{ margin: "5px 0 0", fontSize: 13 }}>Every team must have one unique manager mapping. Team count must match the rows below.</p></div>
          {teams.map((team, index) => <div key={index} className="setup-team-row" style={{ gap: 10, padding: 10, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}><input aria-label={"Team " + (index + 1) + " ID"} placeholder="Team ID" value={team.id} onChange={(event) => updateTeam(index, "id", event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 8px" }} /><input aria-label={"Team " + (index + 1) + " name"} placeholder="Team name" value={team.name} onChange={(event) => updateTeam(index, "name", event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 8px" }} /><input aria-label={"Manager " + (index + 1) + " ID"} placeholder="Manager ID" value={team.managerId} onChange={(event) => updateTeam(index, "managerId", event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 8px" }} /><input aria-label={"Manager " + (index + 1) + " name"} placeholder="Manager display name" value={team.managerName} onChange={(event) => updateTeam(index, "managerName", event.target.value)} style={{ minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 8px" }} /></div>)}
          <button type="button" onClick={() => setTeams((previous) => [...previous, { id: "team-" + (previous.length + 1), name: "", managerId: "manager-" + (previous.length + 1), managerName: "" }])} style={{ width: "fit-content", display: "inline-flex", gap: 5, alignItems: "center", minHeight: 36, borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", padding: "0 12px", fontWeight: 700 }}><Plus size={14} /> Add team</button>
        </section>

        <section className="card" style={{ display: "grid", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>5. Verification inputs</h2>
          <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Known provider player IDs (one per line or comma-separated)</span><textarea value={knownPlayerIds} onChange={(event) => setKnownPlayerIds(event.target.value)} rows={3} placeholder="player-id-1&#10;player-id-2" style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: 10 }} /></label>
          <label style={{ display: "grid", gap: 5, fontSize: 12 }}><span className="muted">Player assignments (one per line: playerId=teamId)</span><textarea value={assignments} onChange={(event) => setAssignments(event.target.value)} rows={3} placeholder="player-id-1=team-1" style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: 10 }} /></label>
        </section>

        <section className="card" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Verification summary</h2>
          {([["League basics", checks.validBasics], ["Team count and unique IDs", checks.validTeams], ["Manager mappings", checks.validMappings], ["Roster slot structure", checks.validSlots], ["Exact scoring coefficients", Object.keys(scoring.passing).length > 0 && Object.keys(scoring.receiving).length > 0]] as const).map(([label, valid]) => <div key={label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>{valid ? <CheckCircle2 size={16} style={{ color: "var(--good)" }} /> : <AlertTriangle size={16} style={{ color: "var(--warn)" }} />}<span>{label}</span><span className="muted">{valid ? "ready for server validation" : "needs attention"}</span></div>)}
          {saveState.message && <div role={saveState.status === "error" ? "alert" : "status"} style={{ padding: 12, borderRadius: 10, background: saveState.status === "error" ? "rgba(180,35,24,0.1)" : "rgba(22,133,75,0.1)", color: saveState.status === "error" ? "var(--bad)" : "var(--good)", fontSize: 13 }}>{saveState.message}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}><button type="submit" disabled={saveState.status === "saving"} style={{ minHeight: 44, border: 0, borderRadius: 999, background: "var(--text)", color: "var(--bg)", padding: "0 18px", fontWeight: 700, opacity: saveState.status === "saving" ? 0.6 : 1 }}>{saveState.status === "saving" ? "Verifying and saving…" : "Verify and save setup"}</button><Link href="/league/settings" className="muted" style={{ fontSize: 13 }}>View settings status</Link></div>
        </section>
      </form>
    </>
  );
}
