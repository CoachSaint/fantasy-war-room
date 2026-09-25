"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoPlayers, type ExtendedPlayer } from "@/lib/demo";
import { PlayerCompareModal } from "@/components/player-compare-modal";
import { LeagueGate } from "@/components/league-gate";
import { useConnectedLeague } from "@/lib/use-connected-league";
import { ArrowUpDown, AlertCircle } from "lucide-react";
import type { DraftBoardPlayer } from "@/lib/services/draft-board";

type Mode = "best" | "value" | "safe" | "upside";
type PositionFilter = "ALL" | "QB" | "RB" | "WR" | "TE";

export default function DraftPage() {
  const league = useConnectedLeague();
  if (league.status === "loading") return <LeagueGate state={league} />;
  if (league.status === "connected") {
    return <ConnectedDraftPage leagueId={league.context.league.id} leagueName={league.context.league.name}
      provider={league.context.league.provider} />;
  }
  if (league.status !== "auth_required" || process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return <LeagueGate state={league} />;
  return <DemoDraftPage />;
}

type DraftHistory = {
  status: string;
  draftStatus: string;
  sourceUrl?: string;
  picks: Array<{ overallPick: number; round: number; playerKey: string;
    playerName: string | null; playerPosition: string | null; observedAt: string }>;
};

type ConnectedBoard = {
  season: number;
  availability: { count: number; truncated: boolean; observedAt: string; sourceUrl: string };
  projections: { sourceUrl: string; matchedCount: number; accuracyVerified: boolean };
  modes: Record<Mode, string>;
  players: DraftBoardPlayer[];
};

const boardErrorText: Record<string, string> = {
  draft_complete: "This draft is complete. The current free-agent list is for waivers, not draft picks.",
  draft_status_unverified: "Yahoo has not verified that this league is in a draft window.",
  yahoo_available_scan_stale: "Yahoo's available-player list is missing or stale. During a live draft it must be less than five minutes old. Run an authenticated Yahoo import to refresh it.",
  yahoo_available_scan_incomplete: "Yahoo's available-player list was incomplete. Run the import again.",
  yahoo_roster_sync_stale: "Your Yahoo team sync is missing or stale. During a live draft it must be less than five minutes old. Reconnect and import your team.",
  draft_projections_unavailable: "No current full-season projections match the verified Yahoo available players. Run Scout and check exact player mappings.",
  roster_slots_unavailable: "Yahoo roster slots have not been imported for this league.",
  scoring_rules_unavailable: "Yahoo scoring rules have not been imported for this league.",
  owned_roster_unavailable: "Your Yahoo team has not been mapped to this login.",
  not_yahoo_league: "A connected Yahoo league is required for the live Draft board.",
};

function ConnectedBoardSection({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<{ status: "loading" } | { status: "error"; code: string } | { status: "ready"; data: ConnectedBoard }>({ status: "loading" });
  const [mode, setMode] = useState<Mode>("best");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/draft/board?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        const payload = await response.json() as ConnectedBoard & { error?: string };
        if (!response.ok) return setBoard({ status: "error", code: payload.error || "draft_board_unavailable" });
        if (!Array.isArray(payload.players)) return setBoard({ status: "error", code: "draft_board_unavailable" });
        setBoard({ status: "ready", data: payload });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBoard({ status: "error", code: "draft_board_unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);
  const players = board.status === "ready" ? board.data.players.filter((player) => position === "ALL" || player.position === position)
    .filter((player) => player.priority[mode] != null)
    .sort((a, b) => (b.priority[mode] || 0) - (a.priority[mode] || 0) || a.yahooOrder - b.yahooOrder) : [];
  const compared = board.status === "ready" ? compareIds.map((id) => board.data.players.find((player) => player.id === id))
    .filter((player): player is DraftBoardPlayer => Boolean(player)) : [];
  return <section className="card" style={{ marginBottom: 20 }}>
    <h2 style={{ marginTop: 0 }}>Available draft board</h2>
    {board.status === "loading" && <p role="status">Checking Yahoo availability and season projections…</p>}
    {board.status === "error" && <p role="alert">{boardErrorText[board.code] || (board.code.startsWith("unsupported_scoring_rules")
      ? `This league has scoring rules the Draft board cannot apply (${board.code.split(":")[1]}).`
      : "The connected Draft board is unavailable. Refresh your Yahoo import and Scout data.")}</p>}
    {board.status === "ready" && <>
      <p className="muted">{board.data.projections.matchedCount} matched offensive players from Yahoo&apos;s first {board.data.availability.count} available entries{board.data.availability.truncated ? " (Yahoo list limited to 200)" : ""}. Full-season projections are estimates; accuracy has not been verified.</p>
      <p className="muted" style={{ fontSize: 12 }}>Yahoo checked {new Date(board.data.availability.observedAt).toLocaleString()} · <a href={board.data.availability.sourceUrl} target="_blank" rel="noopener noreferrer">Yahoo source</a> · <a href={board.data.projections.sourceUrl} target="_blank" rel="noopener noreferrer">Sleeper season source</a></p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }} role="group" aria-label="Draft recommendation mode">
        {([ ["best", "Best Pick"], ["value", "Best Value"], ["safe", "Safe Pick"], ["upside", "Upside Swing"] ] as const).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} className="pill"
            style={{ cursor: "pointer", border: mode === key ? "2px solid var(--text)" : "1px solid var(--line)" }}>{label}</button>)}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>{board.data.modes[mode]}.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }} role="group" aria-label="Filter draft board by position">
        {(["ALL", "QB", "RB", "WR", "TE"] as const).map((key) =>
          <button key={key} type="button" aria-pressed={position === key} onClick={() => setPosition(key)} className="pill"
            style={{ cursor: "pointer", border: position === key ? "2px solid var(--text)" : "1px solid var(--line)" }}>{key}</button>)}
      </div>
      {players.length === 0 && <p className="muted">No source-backed players are available for this mode and position.</p>}
      <div className="grid grid-3">
        {players.slice(0, 60).map((player) => <article key={player.id} className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span className="pill">{player.position} #{player.positionRank} available</span><span className="muted">Yahoo list #{player.yahooOrder}</span></div>
          <h3 style={{ marginBottom: 6 }}>{player.name}</h3>
          <p style={{ margin: "0 0 6px" }}><strong>{player.projectedSeasonPoints.toFixed(1)}</strong> projected {board.data.season} season pts</p>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Open direct {player.position} slots: {player.openDirectStarterSlots ?? "unverified"} · next available gap: {player.nextAvailableEdge == null ? "unknown" : `${player.nextAvailableEdge.toFixed(1)} pts`}</p>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Sleeper ADP: {player.sleeperAdp?.toFixed(1) ?? "unavailable"}{player.providerStatus ? ` · Yahoo ${player.providerStatus}` : ""}</p>
          {player.assumedZeroYahooStatIds.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Unprojected Yahoo stat IDs counted as zero: {player.assumedZeroYahooStatIds.join(", ")}</p>}
          <button type="button" className="pill" aria-pressed={compareIds.includes(player.id)}
            onClick={() => setCompareIds((ids) => ids.includes(player.id) ? ids.filter((id) => id !== player.id) : [...ids.slice(-1), player.id])}
            style={{ cursor: "pointer", marginTop: 8 }}>Compare {compareIds.includes(player.id) ? "✓" : "+"}</button>
        </article>)}
      </div>
      {compared.length === 2 && <div style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 14 }}>
        <h3>Compare selected players</h3>
        <div className="grid grid-2">{compared.map((player) => <div key={player.id}>
          <strong>{player.name} · {player.position}</strong>
          <p>{player.projectedSeasonPoints.toFixed(1)} projected season pts · Yahoo list #{player.yahooOrder} · Sleeper ADP {player.sleeperAdp?.toFixed(1) ?? "unavailable"}</p>
          <p className="muted">Position rank among matched available players: #{player.positionRank}. Next available gap: {player.nextAvailableEdge?.toFixed(1) ?? "unknown"} pts.</p>
        </div>)}</div>
      </div>}
    </>}
  </section>;
}

function ConnectedDraftPage({ leagueId, leagueName, provider }: { leagueId: string; leagueName: string; provider: string }) {
  const [state, setState] = useState<{ status: "loading" | "unavailable" } | { status: "ready"; data: DraftHistory }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/draft?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) return setState({ status: "unavailable" });
        const data = await response.json() as DraftHistory;
        if (!Array.isArray(data.picks)) return setState({ status: "unavailable" });
        setState({ status: "ready", data });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  return <>
    <PageHeader eyebrow={`Draft room · ${leagueName}`} title="Your league draft" description="Yahoo draft status and your verified pick history appear after an authenticated import." />
    {provider === "yahoo" && <ConnectedBoardSection leagueId={leagueId} />}
    {state.status === "loading" && <p role="status">Loading your draft history…</p>}
    {state.status === "unavailable" && <p role="alert">Draft status is unavailable. Your roster and other league decisions remain separate.</p>}
    {state.status === "ready" && state.data.status === "not_yahoo_league" && (
      <section className="card"><h2 style={{ marginTop: 0 }}>Yahoo draft data is not connected</h2><p className="muted">This league was set up manually. Connect an owned Yahoo team to import its draft status and picks.</p></section>
    )}
    {state.status === "ready" && state.data.status !== "not_yahoo_league" && <>
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>{state.data.draftStatus === "postdraft" ? "Draft complete" : state.data.draftStatus === "drafting" ? "Draft in progress" : state.data.draftStatus === "predraft" ? "Draft not started" : "Draft status unverified"}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>Yahoo&apos;s league state and your saved picks appear below. Draft recommendations require a recent Yahoo import and source-backed season projections.</p>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Your pick history</h2>
        {state.data.status === "unavailable" && <p role="alert">Yahoo pick history could not be verified on the last import. Any saved picks below are from an earlier successful import.</p>}
        {state.data.status === "not_started" && <p className="muted">No picks have been made yet.</p>}
        {state.data.status === "ready" && state.data.picks.length === 0 && <p className="muted">Yahoo has not reported a pick for your team yet.</p>}
        {state.data.picks.length > 0 && <div style={{ display: "grid", gap: 8 }}>
          {state.data.picks.map((pick) => <div key={pick.overallPick} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div><strong>Pick {pick.overallPick}</strong> · Round {pick.round}<div className="muted">{pick.playerName || `Yahoo player ${pick.playerKey}`}{pick.playerPosition ? ` · ${pick.playerPosition}` : ""}</div></div>
            <span className="muted" style={{ fontSize: 12 }}>Checked {new Date(pick.observedAt).toLocaleString()}</span>
          </div>)}
        </div>}
        {state.data.sourceUrl && <a href={state.data.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 16 }}>Yahoo draft source</a>}
      </section>
    </>}
  </>;
}

function DemoDraftPage() {
  const [mode, setMode] = useState<Mode>("best");
  const [posFilter, setPosFilter] = useState<PositionFilter>("ALL");
  const [comparingPlayers, setComparingPlayers] = useState<[ExtendedPlayer, ExtendedPlayer] | null>(null);

  // Filter players by position
  const filteredPlayers = demoPlayers.filter((p) => {
    if (posFilter === "ALL") return true;
    return p.position === posFilter;
  });

  // Sort players depending on active recommendation mode
  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (mode === "best") return b.projectedPpg - a.projectedPpg;
    if (mode === "value") return a.adp - b.adp;
    if (mode === "safe") return b.floorPpg - a.floorPpg;
    if (mode === "upside") return b.ceilingPpg - a.ceilingPpg;
    return 0;
  });

  return (
    <>
      <ConfigurationBanner message="Draft rankings use fixture players until league scoring and roster context are connected." />
      <PageHeader
        eyebrow="Draft Room Engine"
        title="Make the pick. Know why."
        description="Available-player recommendations react to scoring, roster construction, positional scarcity, and market value—not a static top-200 list."
      />

      {/* Mode Selector Tabs */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 8, background: "var(--surface)", padding: 6, borderRadius: 999, border: "1px solid var(--line)" }}>
          {(
            [
              ["best", "Best Pick"],
              ["value", "Best Value"],
              ["safe", "Safe Pick"],
              ["upside", "Upside Swing"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 650,
                border: 0,
                background: mode === key ? "var(--text)" : "transparent",
                color: mode === key ? "var(--bg)" : "var(--muted)",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Position Filters */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setPosFilter(pos)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 650,
                border: "1px solid var(--line)",
                background: posFilter === pos ? "var(--surface-strong)" : "transparent",
                color: posFilter === pos ? "var(--text)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
      </section>

      {/* Positional Scarcity Banner */}
      <section
        style={{
          marginBottom: 24,
          padding: "14px 20px",
          borderRadius: 18,
          background: "rgba(255,179,77,0.12)",
          border: "1px solid rgba(255,179,77,0.3)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 13.5,
        }}
      >
        <AlertCircle size={18} style={{ color: "var(--warn)", flexShrink: 0 }} />
        <div>
          <strong>Positional Scarcity Alert:</strong> Tier 1 Tight Ends dropping fast. Adding a TE in Round 4 yields +4.2 PPG replacement edge.
        </div>
      </section>

      {/* Player Cards Grid */}
      <section className="grid grid-3" style={{ marginBottom: 28 }}>
        {sortedPlayers.map((player) => (
          <article
            key={player.id}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 16,
              position: "relative",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span className="pill">
                  {player.position} · Tier {player.tier}
                </span>
                <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                  ADP #{player.adp}
                </span>
              </div>

              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 750 }}>{player.fullName}</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {player.team} • Bye Week {player.byeWeek}
              </div>

              {/* Stats Box */}
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 14,
                  background: "var(--surface)",
                  display: "grid",
                  gap: 6,
                  fontSize: 12.5,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Projected PPG:</span>
                  <strong style={{ color: "var(--good)" }}>{player.projectedPpg} pts</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Floor / Ceiling:</span>
                  <span>{player.floorPpg} - {player.ceilingPpg}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Target Share:</span>
                  <span>{player.targetShare}%</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const otherPlayer = demoPlayers.find((p) => p.id !== player.id && p.position === player.position) || demoPlayers[0];
                setComparingPlayers([player, otherPlayer]);
              }}
              style={{
                width: "100%",
                minHeight: 44,
                border: 0,
                borderRadius: 999,
                background: "var(--text)",
                color: "var(--bg)",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <ArrowUpDown size={15} />
              <span>Compare vs Position</span>
            </button>
          </article>
        ))}
      </section>

      {/* Head to Head Compare Modal */}
      {comparingPlayers && (
        <PlayerCompareModal
          playerA={comparingPlayers[0]}
          playerB={comparingPlayers[1]}
          onClose={() => setComparingPlayers(null)}
        />
      )}
    </>
  );
}
