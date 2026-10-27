# Monitor history chart

The latency chart plots measured samples by their actual timestamps and numeric milliseconds. The history table remains the complete text alternative and is shown newest first. Summary cards and chart use the checks currently loaded; loading more checks updates the summary. The page states the loaded count, oldest-to-newest sample interval, and browser-local timezone. Invalid or absent timestamps never produce a made-up interval.

## Reading the chart

- Horizontal spacing reflects elapsed time; date/time tick density adapts to the chart width.
- Vertical ticks are numeric milliseconds, with the `ms` unit in a reserved band above the plot. Zero is a measurement; missing or non-finite latency breaks the line and remains identified as unavailable.
- A line gap is marked “No samples” only when consecutive valid timestamps differ by **more than 3× the current configured frequency**; equality is not a gap. The chart labels each gap duration; expand **How to read this chart** for the exact threshold and frequency limitations. A visible note always distinguishes missing samples from confirmed downtime. If current frequency is missing or invalid, no gap schedule is applied. This is a missing-samples heuristic, never evidence of downtime; historical frequency changes are unavailable.
- Healthy measurements use circles; failed checks with measured durations use squares; unavailable latency uses crosses. Failed checks retain their measured duration. The legend explains the distinction, and no-latency checks remain represented in the table and selection details.

History loads in 50-check increments up to 200. A successfully returned batch shorter than its requested limit means no older checks are available; a full batch means the history boundary is still unknown. The 200-check display is an explicit client cap, not proof that history is exhausted. Failed expansions retain the last successful rows and retry the same requested limit.

Median and nearest-rank P95 latency summarize every finite recorded duration, including failed checks with measured time; cards show one decimal place while table and selection details retain full precision. Healthy-check percentage keeps its existing formula over loaded rows.

Use the plot area to select a check, or use its single visible **Select check** slider. Calculation details are collapsed by default in a native disclosure that supports pointer and keyboard activation. The control selects individual samples even when timestamps coincide; arrow keys, Home, and End are supported. The live detail gives check status, latency availability, and the full date/time in the browser's local timezone. The chart is an atomic SVG image with a title and description; selection is provided separately so assistive technology does not lose chart children to slider semantics.
