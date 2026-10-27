import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { MonitorHistoryRow } from "../../../app/api/endpoints";
import { buildLatencyChartGeometry, LATENCY_CHART_HEIGHT } from "./chart-geometry";

interface Props {
  rows: readonly MonitorHistoryRow[];
  frequencySeconds?: number | null;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "long",
  }).format(date);
}

export function LatencyChart({ rows, frequencySeconds }: Props) {
  const uid = useId().replace(/:/g, "");
  const titleId = `latency-title-${uid}`;
  const descriptionId = `latency-description-${uid}`;
  const [width, setWidth] = useState(640);
  const [selected, setSelected] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const updateWidth = (next: number) => {
      if (Number.isFinite(next) && next > 0) setWidth(next);
    };
    updateWidth(element.clientWidth || 640);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => updateWidth(entries[0]?.contentRect.width ?? 640));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geometry = buildLatencyChartGeometry(rows, frequencySeconds, width);
  const pointIndex = Math.min(selected, Math.max(0, geometry.points.length - 1));
  const current = geometry.points[pointIndex];
  const unavailableCount = geometry.points.filter(({ y }) => y === null).length;
  const measuredCount = geometry.points.length - unavailableCount;
  const summary = `${rows.length} checks, ordered chronologically. ${measuredCount} measured latency values and ${unavailableCount} checks with latency unavailable. ${geometry.gaps.length} missing-samples heuristic gap${geometry.gaps.length === 1 ? "" : "s"}, based on the monitor's current frequency; this does not indicate downtime.`;

  function selectNearest(event: PointerEvent<SVGSVGElement>) {
    if (!geometry.points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = bounds.width > 0
      ? ((event.clientX - bounds.left) / bounds.width) * width
      : event.clientX;
    let nearest = 0;
    geometry.points.forEach((point, index) => {
      if (Math.abs(point.x - localX) < Math.abs(geometry.points[nearest].x - localX)) nearest = index;
    });
    setSelected(nearest);
  }

  function moveSelection(event: KeyboardEvent<HTMLInputElement>) {
    if (geometry.points.length === 0) return;
    const last = geometry.points.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(last, pointIndex + 1)
      : event.key === "ArrowLeft" ? Math.max(0, pointIndex - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next !== null) {
      event.preventDefault();
      setSelected(next);
    }
  }

  const frequencyIsValid = Number.isFinite(frequencySeconds) && (frequencySeconds ?? 0) > 0;
  const gapGuidance = frequencyIsValid
    ? `A line gap is marked “No samples” only when consecutive valid timestamps differ by more than 3× the current frequency (frequency: ${frequencySeconds} s; split threshold: > ${3 * (frequencySeconds as number)} s). The interval is shown for each gap. This missing-samples heuristic is not downtime; historical frequency changes are unknown.`
    : "No gap schedule is applied because the current frequency is unavailable or invalid. Missing samples never indicate downtime; historical frequency changes are unknown.";
  const selectionValue = current
    ? `${current.row.state === "healthy" ? "Healthy" : current.row.state === "unhealthy" ? "Down" : "Unknown"} check, ${current.row.latency_ms !== null && Number.isFinite(current.row.latency_ms) ? `${current.row.latency_ms} ms` : "latency unavailable"} · ${localDateTime(current.row.created_at)}`
    : "No sample selected";

  return <div ref={container} className="min-w-0">
    {rows.length === 0 ? <p className="rounded-control border border-dashed border-line-strong bg-canvas/30 p-6 text-center text-sm leading-6 text-muted">No checks are available to chart.</p> : <>
    {measuredCount === 0 && <p className="mb-2 rounded-control border border-dashed border-line-strong bg-canvas/30 p-3 text-sm leading-6 text-muted">Checks are available, but none has a measured latency. Their status and timestamps remain selectable and are listed in the table.</p>}
    <p id={`${descriptionId}-instructions`} className="text-xs leading-5 text-muted">Select a check using the plot or the slider below.</p>
    <p className="mb-2 text-xs leading-5 text-muted">Gaps mean missing samples, not confirmed downtime.</p>
    <div className="overflow-x-auto">
      {/* Reserve a heading band without changing the plot's data coordinates. */}
      <svg
        role="img" aria-labelledby={titleId} aria-describedby={descriptionId}
        viewBox={`0 -24 ${width} ${LATENCY_CHART_HEIGHT + 24}`} preserveAspectRatio="none"
        className="h-[244px] min-w-[320px] w-full overflow-visible rounded-control"
        onPointerUp={selectNearest} onClick={selectNearest}
      >
        <title id={titleId}>Latency history</title>
        <desc id={descriptionId}>{summary} {gapGuidance} Use the plot or selection control to select a check.</desc>
        {geometry.yTicks.map((tick) => <g key={tick.value}>
          <line x1={geometry.left} x2={geometry.right} y1={tick.position} y2={tick.position} stroke="currentColor" className="text-line/60" />
          <text x={geometry.left - 7} y={tick.position + 3} textAnchor="end" className="fill-current font-mono text-[10px] text-muted">{tick.label}</text>
        </g>)}
        {geometry.xTicks.map((tick) => <g key={`${tick.value}-${tick.position}`}>
          <line x1={tick.position} x2={tick.position} y1={geometry.top} y2={geometry.bottom} stroke="currentColor" className="text-line/30" />
          <text x={tick.position} y={LATENCY_CHART_HEIGHT - 8} textAnchor="middle" className="fill-current font-mono text-[10px] text-muted">{tick.label}</text>
        </g>)}
        {measuredCount > 0 && <text x={geometry.left - 8} y={geometry.top - 16} textAnchor="end" className="fill-current font-mono text-[10px] text-muted">ms</text>}
        {geometry.segments.map((segment, index) => <polyline key={index} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />)}
        {geometry.gaps.map((gap, index) => <g key={`gap-${index}`}>
          <line x1={gap.x} x2={gap.x} y1={geometry.top} y2={geometry.bottom} stroke="currentColor" strokeDasharray="3 3" className="text-muted" />
          <text x={gap.x} y={geometry.top + 12} textAnchor="middle" className="fill-current font-mono text-[10px] text-muted">No samples ({(gap.durationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}s)</text>
        </g>)}
        {geometry.points.map((point) => point.y === null
          ? <path key={point.row.id} d={`M ${point.x - 4} ${geometry.bottom - 4} L ${point.x + 4} ${geometry.bottom + 4} M ${point.x + 4} ${geometry.bottom - 4} L ${point.x - 4} ${geometry.bottom + 4}`} stroke="currentColor" strokeWidth="2" className={point.row.state === "unhealthy" ? "text-danger" : "text-muted"} />
          : point.row.state === "unhealthy"
            ? <rect key={point.row.id} data-marker="failed-measured" x={point.x - 4.5} y={point.y - 4.5} width="9" height="9" fill="currentColor" className="text-danger" />
            : <circle key={point.row.id} data-marker="healthy-measured" cx={point.x} cy={point.y} r="3.5" fill="currentColor" className="text-accent" />)}
        {current && <circle cx={current.x} cy={current.y ?? geometry.bottom} r="9" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />}
        <rect aria-label="Latency plot selection area" x={geometry.left} y={geometry.top} width={geometry.right - geometry.left} height={geometry.bottom - geometry.top} fill="transparent" className="cursor-crosshair" />
      </svg>
    </div>
    <ul aria-label="Chart legend" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <li><span aria-hidden="true" className="mr-1 text-accent">●</span>Healthy measurement</li>
      <li><span aria-hidden="true" className="mr-1 text-danger">■</span>Down check with measured duration</li>
      <li><span aria-hidden="true" className="mr-1">×</span>Latency unavailable</li>
    </ul>
    <label className="mt-2 block text-sm text-ink">
      <span>Select check <span className="text-xs text-muted">(arrow keys, Home, End)</span></span>
      <input
        type="range" min={0} max={Math.max(0, geometry.points.length - 1)} step={1} value={pointIndex}
        aria-valuetext={selectionValue} onChange={(event) => setSelected(Number(event.currentTarget.value))}
        onKeyDown={moveSelection}
        className="mt-1 block h-11 w-full touch-pan-x accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </label>
    {current && <p aria-live="polite" className="mt-2 text-sm text-ink">{selectionValue}</p>}
    <details className="mt-3 text-xs leading-5 text-muted">
      <summary className="w-fit cursor-pointer rounded-control text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">How to read this chart</summary>
      <p className="mt-2">{gapGuidance}</p>
      <p className="mt-2">The table below lists all checks, newest first.</p>
    </details>
    </>}
  </div>;
}
