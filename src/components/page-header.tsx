export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header style={{ margin: "28px 0 28px" }}>
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="display">{title}</h1>
      <p className="muted" style={{ maxWidth: 680, fontSize: 18, lineHeight: 1.5, margin: 0 }}>{description}</p>
    </header>
  );
}
