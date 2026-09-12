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
    return <p className="text-sm text-slate-500">No monitors yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {monitors.map((monitor) => (
        <MonitorRow key={monitor.id} monitor={monitor} now={now} />
      ))}
    </ul>
  );
}