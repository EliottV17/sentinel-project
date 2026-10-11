# Monitor history chart

The latency chart plots measured samples by their actual timestamps and numeric milliseconds. The history table remains the complete text alternative and is shown newest first.

## Reading the chart

- Horizontal spacing reflects elapsed time; date/time tick density adapts to the chart width.
- Vertical ticks are numeric milliseconds. Zero is a measurement; missing or non-finite latency breaks the line and remains identified as unavailable.
- A line gap is marked “No samples” only when consecutive valid timestamps differ by **more than 3× the current configured frequency**; equality is not a gap. The chart states the applicable threshold and gap duration. If current frequency is missing or invalid, no gap schedule is applied. This is a missing-samples heuristic, never evidence of downtime; historical frequency changes are unavailable.
- Healthy measurements use circles; failed checks with measured durations use squares; unavailable latency uses crosses. Failed checks retain their measured duration. The legend explains the distinction, and no-latency checks remain represented in the table and selection details.

Use the plot area to select a check, or use its single visible, 44-pixel-high range control. The control selects individual samples even when timestamps coincide; arrow keys, Home, and End are supported. The live detail gives check status, latency availability, and the full date/time in the browser's local timezone. The chart is an atomic SVG image with a title and description; selection is provided separately so assistive technology does not lose chart children to slider semantics.
