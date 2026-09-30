import type { components } from "../../lib/api/schema";

type LastState = components["schemas"]["MonitorRead"]["last_state"];

interface PillStyle {
  label: string;
  className: string;
}

/**
 * Pure `last_state` → pill mapping. The pill is derived from `last_state`
 * only (last-writer-wins across the two engines); `check_config` is never
 * surfaced anywhere in the row.
 */
const PILL_STYLES: Record<string, PillStyle> = {
  healthy: { label: "Healthy", className: "bg-green-100 text-green-700" },
  unhealthy: { label: "Unhealthy", className: "bg-red-100 text-red-700" },
};

const NEVER_CHECKED: PillStyle = {
  label: "Never checked",
  className: "bg-slate-100 text-slate-500",
};

export function StatusPill({ lastState }: { lastState: LastState }) {
  const style =
    (lastState !== null && PILL_STYLES[lastState]) || NEVER_CHECKED;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}