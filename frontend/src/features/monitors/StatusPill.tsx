import type { components } from "../../lib/api/schema";

type MonitorRead = components["schemas"]["MonitorRead"];
type LastState = MonitorRead["last_state"];

interface PillStyle {
  label: string;
  className: string;
}

const PILL_STYLES: Record<string, PillStyle> = {
  healthy: { label: "Healthy", className: "border-success/30 bg-success-soft text-success" },
  unhealthy: { label: "Unhealthy", className: "border-danger/30 bg-danger-soft text-danger" },
};

const MUTED_STYLE = "border-line bg-raised text-muted";

export function StatusPill({ state = "Active", lastState }: { state?: MonitorRead["state"]; lastState: LastState }) {
  const active = state === "Active";
  const label = active
    ? (lastState !== null && PILL_STYLES[lastState]?.label) || "Never checked"
    : state;
  const style = active && lastState !== null ? PILL_STYLES[lastState] : undefined;
  const className = style?.className ?? MUTED_STYLE;
  const icon = label === "Healthy" ? "✓" : label === "Unhealthy" ? "×" : label === "Never checked" ? "?" : "–";

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-semibold ${className}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
