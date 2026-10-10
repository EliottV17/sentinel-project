# Frontend UI polish

## Objective and rationale
Raise the visual quality of the existing frontend (modern, premium, professional) by refining Tailwind classes only: visual hierarchy of text, consistent spacing, soft shadows, subtle borders, smooth micro-interactions, and responsive behavior.

## Scope and constraints
- Directory: `frontend/src`, branch `feature/ui-refinement`.
- `frontend/src/app/styles/globals.css` MUST NOT be modified; its palette/tokens are fixed. Use only existing tokens (canvas, surface, raised, line, ink, muted, subtle, accent, success, warning, danger and their -soft variants); finer shades via Tailwind opacity modifiers.
- No changes to API calls, hooks, handlers, validation, routing, or any behavior. Only `className` and minimal presentational markup. Keep text content and ARIA attributes tests rely on.
- `sentinel-interface-design.zip` was already used as the base design; it is not a reference now. Leave it untracked and untouched. Do not stage the deleted `frontend/screenshots/*` files.
- Components relying on legacy overrides in globals.css (`.dashboard-button`, `.pill-status`, `.status-badge`) migrate to direct token utilities; tests asserting legacy class names (`MonitorList.test.tsx:57-71`) are updated accordingly (style-only).
- One work-unit commit per task (`style(ui): ...`). No push, PR or merge.

## Tasks
- [ ] T1 — Shared primitives: Button, Card, Input, Spinner, SentinelBrand, AppShell.
- [ ] T2 — Typography and spacing system. Defined as the design language below and applied inside T1/T3–T6 (no separate code unit; closed when T6 is done and consistency is checked).
- [ ] T3 — Login and Register pages.
- [ ] T4 — Monitors: MonitorsPage, CreateMonitorForm, MonitorList, MonitorRow, StatusPill, DeleteButton (+ test update).
- [ ] T5 — Public Status page.
- [ ] T6 — Monitor history page.
- [ ] T7 — Verification: typecheck, lint, tests, build, responsive visual check, globals.css untouched.

## Design language (all tasks follow this; tokens only)
- Panel: `rounded-panel border border-line bg-surface shadow-panel`; padding `p-5 sm:p-6`. Interactive panel adds `transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow`.
- Eyebrow: `text-xs font-semibold uppercase tracking-[0.18em] text-accent`. Page title: serif `text-3xl sm:text-4xl font-semibold tracking-tight text-ink`; lead: `text-base leading-7 text-muted`. Section title: `text-lg font-semibold tracking-tight text-ink`. Field/metric label: `text-xs font-medium uppercase tracking-wider text-muted` (metrics) or `text-sm font-medium text-ink` (form fields). Caption: `text-xs text-subtle/muted`.
- Spacing rhythm: sections `space-y-6 sm:space-y-8`, panel inner gaps 4/5, control gap 3.
- Primary button: `bg-accent-strong text-canvas shadow-sm hover:bg-accent hover:shadow-glow active:scale-[0.98]`; danger: `bg-danger-strong text-canvas hover:bg-danger`; secondary/ghost: `border border-line-strong text-muted hover:border-accent hover:bg-raised hover:text-ink`. All: `transition duration-150`, `focus-visible:ring-2 ring-accent/40`, `disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100`.
- Status chips: success `border-success/30 bg-success-soft text-success`; warning `border-warning/30 bg-warning-soft text-warning`; danger `border-danger/30 bg-danger-soft text-danger`; neutral `border-line bg-raised text-muted`.
- Responsive: mobile-first, no horizontal overflow at 320–375 px; keep existing breakpoints' behavior.

## Evidence
(commit identities and check results recorded per task)
