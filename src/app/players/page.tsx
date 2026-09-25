"use client";

import { useEffect, useState } from "react";
import { useConnectedLeague } from "@/lib/use-connected-league";
import { LeagueGate } from "@/components/league-gate";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoPlayers, demoEvidence, type ExtendedPlayer } from "@/lib/demo";
import { Search, FileText } from "lucide-react";

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE";

type ConnectedPlayer = { id: string; full_name: string; team: string | null; position: string; status: string | null };
type PlayerDetail = {
  player: ConnectedPlayer;
  snapshots: Array<{ season: number; week: number; data: Record<string, unknown>; observed_at: string; source: string }>;
  evidence: Array<{ id: string; type: string; source: string; source_url: string | null; summary: string; observed_at: string }>;
};

export default function PlayersPage() {
  const league = useConnectedLeague();
  if (league.status === "loading") return <LeagueGate state={league} />;
  if (league.status === "connected") return <ConnectedPlayersPage leagueId={league.context.league.id} leagueName={league.context.league.name} season={league.context.league.season} week={league.context.league.currentWeek} />;
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return <LeagueGate state={league} />;
  return <DemoPlayersPage />;
}

function ConnectedPlayersPage({ leagueId, leagueName, season, week }: { leagueId: string; leagueName: string; season: number; week: number }) {
  const [players, setPlayers] = useState<ConnectedPlayer[] | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/players?leagueId=${encodeURIComponent(leagueId)}`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setError(true);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("players" in body)) return setError(true);
        const list = (body as { players: ConnectedPlayer[] }).players;
        if (!Array.isArray(list)) return setError(true);
        setPlayers(list);
        setSelectedId(list[0]?.id ?? null);
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(true);
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/players?leagueId=${encodeURIComponent(leagueId)}&playerId=${encodeURIComponent(selectedId)}`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setError(true);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("player" in body)) return setError(true);
        setDetail(body as PlayerDetail);
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(true);
      }
    })();
    return () => controller.abort();
  }, [leagueId, selectedId]);

  const filtered = (players || []).filter((player) => `${player.full_name} ${player.team ?? ""} ${player.position}`.toLowerCase().includes(search.toLowerCase()));
  const currentProjection = detail?.snapshots.find((snapshot) => snapshot.season === season && snapshot.week === week && snapshot.source === "sleeper_weekly_projections");
  const latestActual = detail?.snapshots.find((snapshot) => typeof snapshot.data?.actualFantasyPoints === "number");
  const ppr = currentProjection?.data?.projectedFantasyPointsPpr;
  const halfPpr = currentProjection?.data?.projectedFantasyPointsHalfPpr;
  const standard = currentProjection?.data?.projectedFantasyPointsStandard;

  return (
    <>
      <PageHeader eyebrow={`Player intelligence · ${leagueName}`} title="Connected players" description="League roster identities and source-backed player history." />
      {error && <p role="alert">Player data could not be loaded. No demo players were substituted.</p>}
      {!players && !error && <p role="status">Loading connected players…</p>}
      {players && players.length === 0 && <section className="card"><h2 style={{ marginTop: 0 }}>No players imported</h2><p className="muted">Import your league roster to populate this view.</p></section>}
      {players && players.length > 0 && (
        <div className="grid grid-2">
          <section className="card" style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <label htmlFor="connected-player-search">Search league players</label>
            <input id="connected-player-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} style={{ minHeight: 44, padding: 10, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-strong)", color: "var(--text)" }} />
            <div style={{ display: "grid", gap: 6, maxHeight: 540, overflowY: "auto" }}>
              {filtered.map((player) => <button key={player.id} type="button" onClick={() => { setDetail(null); setSelectedId(player.id); }} style={{ textAlign: "left", padding: 10, border: "1px solid var(--line)", borderRadius: 10, background: selectedId === player.id ? "var(--surface-strong)" : "var(--surface)", color: "var(--text)" }}><strong>{player.full_name}</strong><span className="muted" style={{ display: "block", fontSize: 12 }}>{player.position} · {player.team ?? "No team"}{player.status ? ` · ${player.status}` : ""}</span></button>)}
            </div>
          </section>
          <section className="card" style={{ display: "grid", gap: 12, alignContent: "start" }}>
            {!detail && <p role="status">Loading player detail…</p>}
            {detail && <>
              <h2 style={{ margin: 0 }}>{detail.player.full_name}</h2>
              <p className="muted" style={{ margin: 0 }}>{detail.player.position} · {detail.player.team ?? "No team"}{detail.player.status ? ` · ${detail.player.status}` : ""}</p>
              {currentProjection ? <p style={{ margin: 0 }}>Week {week} forecast: {typeof standard === "number" ? `${standard} standard` : "standard unavailable"} · {typeof halfPpr === "number" ? `${halfPpr} half PPR` : "half PPR unavailable"} · {typeof ppr === "number" ? `${ppr} PPR` : "PPR unavailable"} <span className="muted">(Sleeper, observed {new Date(currentProjection.observed_at).toLocaleString()}; accuracy unverified)</span></p> : <p className="muted">No current-week forward projection is available for this player.</p>}
              {latestActual && <p className="muted" style={{ margin: 0 }}>Week {latestActual.week}, {latestActual.season} actual: {String(latestActual.data.actualFantasyPoints)} points ({latestActual.source}).</p>}
              <h3 style={{ marginBottom: 0 }}>Evidence</h3>
              {detail.evidence.length === 0 ? <p className="muted">No evidence has been saved for this player.</p> : detail.evidence.map((item) => <article key={item.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}><strong>{item.type.replaceAll("_", " ")}</strong><p style={{ margin: "4px 0" }}>{item.summary}</p><span className="muted" style={{ fontSize: 12 }}>{item.source} · {new Date(item.observed_at).toLocaleString()}</span>{item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>Source</a>}</article>)}
            </>}
          </section>
        </div>
      )}
    </>
  );
}

function DemoPlayersPage() {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<ExtendedPlayer>(demoPlayers[0]);

  const filteredPlayers = demoPlayers.filter((p) => {
    const matchesSearch = p.fullName.toLowerCase().includes(search.toLowerCase()) || (p.team && p.team.toLowerCase().includes(search.toLowerCase()));
    const matchesPos = posFilter === "ALL" || p.position === posFilter;
    return matchesSearch && matchesPos;
  });

  const playerEvidences = demoEvidence.filter((e) => e.playerId === selectedPlayer.id);

  return (
    <>
      <ConfigurationBanner message="Player identity, projections, and evidence are fixture data until provider connections are configured." />
      <PageHeader
        eyebrow="Player Intelligence Explorer"
        title="Every score has a trail."
        description="Search player identity, current role, projection, trend, and evidence without exposing provider-specific payloads to the interface."
      />

      {/* Search & Filter Section */}
      <section
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
          <Search
            size={18}
            className="muted"
            style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            aria-label="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player name, team, or position..."
            style={{
              width: "100%",
              minHeight: 48,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-strong)",
              color: "var(--text)",
              paddingLeft: 46,
              paddingRight: 16,
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setPosFilter(pos)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 650,
                border: "1px solid var(--line)",
                background: posFilter === pos ? "var(--text)" : "var(--surface)",
                color: posFilter === pos ? "var(--bg)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
      </section>

      {/* Player Grid & Evidence Detail View */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left: Player List */}
        <section style={{ display: "grid", gap: 12 }}>
          {filteredPlayers.map((player) => {
            const isSelected = player.id === selectedPlayer.id;
            return (
              <div
                key={player.id}
                onClick={() => setSelectedPlayer(player)}
                style={{
                  padding: 16,
                  borderRadius: 20,
                  background: isSelected ? "var(--surface-strong)" : "var(--surface)",
                  border: isSelected ? "2px solid var(--text)" : "1px solid var(--line)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  <span className="pill" style={{ fontSize: 11 }}>
                    {player.position} · {player.team}
                  </span>
                  <h3 style={{ margin: "6px 0 2px", fontSize: 18, fontWeight: 750 }}>{player.fullName}</h3>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Target Share: {player.targetShare}% • Snap Share: {player.snapShare}%
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="score" style={{ fontSize: 32 }}>
                    {player.projectedPpg}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>Proj PPG</div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Right: Selected Player Detail Drawer */}
        <section className="card" style={{ display: "grid", gap: 20, height: "fit-content" }}>
          <div>
            <span className="pill" style={{ fontSize: 12 }}>{selectedPlayer.position} · {selectedPlayer.team} · Bye Week {selectedPlayer.byeWeek}</span>
            <h2 className="title" style={{ marginTop: 10, fontSize: 32 }}>{selectedPlayer.fullName}</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              ADP #{selectedPlayer.adp} • Status: {selectedPlayer.status}
            </div>
          </div>

          {/* Usage Shares Box */}
          <div style={{ background: "var(--surface)", padding: 16, borderRadius: 18, display: "grid", gap: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }} className="muted">
              Role & Usage Telemetry
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Projected PPG:</span>
              <strong style={{ color: "var(--good)" }}>{selectedPlayer.projectedPpg} PPG</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Floor / Ceiling:</span>
              <span>{selectedPlayer.floorPpg} - {selectedPlayer.ceilingPpg} PPG</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Snap Share:</span>
              <span>{selectedPlayer.snapShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Target Share:</span>
              <span>{selectedPlayer.targetShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Red Zone Touch Share:</span>
              <span>{selectedPlayer.redzoneTouchShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Matchup:</span>
              <span style={{ fontWeight: 700, color: selectedPlayer.matchupDifficulty === "easy" ? "var(--good)" : "var(--warn)" }}>
                {selectedPlayer.matchupRank}
              </span>
            </div>
          </div>

          {/* Evidence Trail List */}
          <div>
            <h3 style={{ fontSize: 16, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={16} /> Evidence Trail ({playerEvidences.length} items)
            </h3>

            {playerEvidences.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {playerEvidences.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: "var(--good)" }}>{ev.type.toUpperCase()}</span>
                      <span className="muted">{Math.round(ev.confidence * 100)}% confidence</span>
                    </div>
                    <div style={{ lineHeight: 1.4 }}>{ev.summary}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Source: {ev.source}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                Scout monitoring active. Baseline nflverse metrics updated for Week 1.
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
