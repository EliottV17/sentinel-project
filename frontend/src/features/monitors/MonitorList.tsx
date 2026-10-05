import type { components } from "../../lib/api/schema";
import { MonitorRow } from "./MonitorRow";

type MonitorRead = components["schemas"]["MonitorRead"];

export function MonitorList({
  monitors,
  now = new Date(),
}: {
  monitors: MonitorRead[];
  now?: Date;
}) {
  if (monitors.length === 0) {
    return <p className="rounded-panel border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-sm text-muted">No monitors yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {monitors.map((monitor) => (
        <MonitorRow key={monitor.id} monitor={monitor} now={now} />
      ))}
    </ul>
  );
}