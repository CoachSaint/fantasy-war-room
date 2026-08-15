import { GpuBadge } from "@/components/gpu-badge";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header style={{ marginBottom: 28, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span className="eyebrow">{eyebrow}</span>
        <GpuBadge />
      </div>
      <h1 className="display" style={{ margin: "4px 0 8px" }}>
        {title}
      </h1>
      <p className="muted" style={{ maxWidth: 760, fontSize: 16, lineHeight: 1.5, margin: 0 }}>
        {description}
      </p>
    </header>
  );
}
