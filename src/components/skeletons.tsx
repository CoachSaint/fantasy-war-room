"use client";

export function SkeletonBlock({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`skeleton-pulse ${className}`}
      style={{
        background: "var(--line)",
        borderRadius: 8,
        opacity: 0.6,
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonBlock style={{ width: 80, height: 26, borderRadius: 999 }} />
        <SkeletonBlock style={{ width: 48, height: 38, borderRadius: 8 }} />
      </div>
      <div>
        <SkeletonBlock style={{ width: "85%", height: 24, marginBottom: 10 }} />
        <SkeletonBlock style={{ width: "60%", height: 16 }} />
      </div>
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
        <SkeletonBlock style={{ width: 120, height: 16 }} />
        <SkeletonBlock style={{ width: 90, height: 16 }} />
      </div>
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <header style={{ marginBottom: 28, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonBlock style={{ width: 140, height: 16 }} />
        <SkeletonBlock style={{ width: 110, height: 32, borderRadius: 999 }} />
      </div>
      <SkeletonBlock style={{ width: 320, height: 48, margin: "8px 0" }} />
      <SkeletonBlock style={{ width: "70%", height: 18 }} />
    </header>
  );
}

export function TodaySkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <SkeletonBlock style={{ width: "100%", height: 80, borderRadius: 24, marginBottom: 24 }} />
      <div className="grid grid-3" style={{ marginBottom: 28 }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="card" style={{ display: "grid", gap: 16 }}>
        <SkeletonBlock style={{ width: 220, height: 28 }} />
        <SkeletonBlock style={{ width: "100%", height: 50, borderRadius: 14 }} />
        <SkeletonBlock style={{ width: "100%", height: 50, borderRadius: 14 }} />
      </div>
    </div>
  );
}

export function DraftSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <SkeletonBlock style={{ width: 340, height: 44, borderRadius: 999 }} />
        <SkeletonBlock style={{ width: 200, height: 36, borderRadius: 999 }} />
      </div>
      <SkeletonBlock style={{ width: "100%", height: 50, borderRadius: 18, marginBottom: 24 }} />
      <div className="grid grid-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

export function LineupSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="grid grid-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

export function WaiversSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div style={{ display: "grid", gap: 20 }}>
        <SkeletonBlock style={{ width: "100%", height: 200, borderRadius: 24 }} />
        <SkeletonBlock style={{ width: "100%", height: 200, borderRadius: 24 }} />
      </div>
    </div>
  );
}

export function PlayersSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <SkeletonBlock style={{ width: "100%", height: 48, borderRadius: 999, marginBottom: 24 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <SkeletonBlock style={{ width: "100%", height: 80, borderRadius: 20 }} />
          <SkeletonBlock style={{ width: "100%", height: 80, borderRadius: 20 }} />
          <SkeletonBlock style={{ width: "100%", height: 80, borderRadius: 20 }} />
        </div>
        <SkeletonBlock style={{ width: "100%", height: 380, borderRadius: 24 }} />
      </div>
    </div>
  );
}
