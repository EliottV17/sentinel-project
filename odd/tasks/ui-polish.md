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
- [x] T1 — Shared primitives: Button, Card, Input, Spinner, SentinelBrand, AppShell. **Done in `d214040`**; typecheck, lint, 175 tests green.
- [x] T2 — Typography and spacing system. Applied inside T1/T3–T6 (no separate source unit). Final delegated consistency readback passed across 16 changed TSX components; intentional compact metric/row and hero variants documented below.
- [x] T3 — Login and Register pages. **Done in this commit** (see git log `style(ui): polish login and register`); typecheck, lint, 175 tests green.
- [x] T4 — Monitors: MonitorsPage, CreateMonitorForm, MonitorList, MonitorRow, StatusPill, DeleteButton (+ test update). **Done in `style(ui): polish monitors dashboard`**; StatusPill migrated to tokens, 3 class assertions updated; 175 tests green.
- [x] T5 — Public Status page. **Done in `style(ui): polish public status page`**; legacy badge class removed, 175 tests green.
- [x] T6 — Monitor history page. **Done in `style(ui): polish monitor history page`**; className-only diff verified; 175 tests green.
- [x] T7 — Verification: typecheck, lint, 175 tests, build, sequential responsive visual checks and final structural readback passed. Verified source HEAD `83b3306`; verification record remains uncommitted. No new source changes or delivery operations.

## Design language (all tasks follow this; tokens only)
- Panel: `rounded-panel border border-line bg-surface shadow-panel`; padding `p-5 sm:p-6`. Interactive panel adds `transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-glow`.
- Eyebrow: `text-xs font-semibold uppercase tracking-[0.18em] text-accent`. Page title: serif `text-3xl sm:text-4xl font-semibold tracking-tight text-ink`; lead: `text-base leading-7 text-muted`. Section title: `text-lg font-semibold tracking-tight text-ink`. Field/metric label: `text-xs font-medium uppercase tracking-wider text-muted` (metrics) or `text-sm font-medium text-ink` (form fields). Caption: `text-xs text-subtle/muted`.
- Spacing rhythm: sections `space-y-6 sm:space-y-8`, panel inner gaps 4/5, control gap 3.
- Primary button: `bg-accent-strong text-canvas shadow-sm hover:bg-accent hover:shadow-glow active:scale-[0.98]`; danger: `bg-danger-strong text-canvas hover:bg-danger`; secondary/ghost: `border border-line-strong text-muted hover:border-accent hover:bg-raised hover:text-ink`. All: `transition duration-150`, `focus-visible:ring-2 ring-accent/40`, `disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100`.
- Status chips: success `border-success/30 bg-success-soft text-success`; warning `border-warning/30 bg-warning-soft text-warning`; danger `border-danger/30 bg-danger-soft text-danger`; neutral `border-line bg-raised text-muted`.
- Responsive: mobile-first, no horizontal overflow at 320–375 px; keep existing breakpoints' behavior.

## Evidence
(commit identities and check results recorded per task)

### T7 sequential verification (completed)
- `globals.css`: unchanged against `b15a659` and in worktree.
- `bun run typecheck`: exit 0.
- `bun run lint`: exit 0.
- `bun run test`: 26 files, 175 tests passed; runtime localStorage warnings observed.
- `bun run build`: exit 0; Zod annotation and >500 kB chunk warnings observed (not classified as regressions).
- Public preview at 375px: Login and Register inspected; Status error layout inspected without API. These do not cover desktop or 320px.
- User authorized real full stack: `docker compose up -d --build` exit 0; API/DB healthy, worker/frontend running.
- Real demo Monitors at 375px: screenshot `/tmp/ui-verify/monitors-375.png`, html scrollWidth = clientWidth = 375; two monitors displayed.
- Delegated verification (`gentle-ai-verify`, verification-command routing): real demo history at 375px passed. Dashboard-discovered route `/monitors/20266`; monitors/history/alerts requests all 200; zero console errors/unhandled exceptions; html/body scrollWidth = clientWidth = 375. Table scroll is contained within its card. Screenshot `/tmp/ui-verify/history-375.png`; verifier Chromium terminated.
- Real public Status at 375px passed (`gentle-ai-verify`): `/api/v1/public/status` returned 200, populated service data rendered, zero console errors/unhandled exceptions, html/body scrollWidth = clientWidth = 375 and zero elements outside viewport. Screenshot `/tmp/ui-verify/status-real-375.png`; verifier browser terminated.
- Real demo Monitors at 1440×1000 desktop passed (`gentle-ai-verify`): actual demo-login and monitors requests 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 1440, zero out-of-viewport elements. Centered 976px container, three metric columns, two-column form/list layout; no clipping. Screenshot `/tmp/ui-verify/monitors-1440.png`; verifier browser terminated.
- Real demo Monitor history at 1440×1000 desktop passed (`gentle-ai-verify`): dashboard-discovered `/monitors/20266`, demo-login/monitors/history/alerts all 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 1440, zero out-of-viewport elements. Four-column metrics, contained chart and 924px table within 976px panel. Screenshot `/tmp/ui-verify/history-1440.png`; verifier browser terminated.
- Real public Status at 1440×1000 desktop passed (`gentle-ai-verify`): `/api/v1/public/status` returned 200 with populated service data; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 1440, zero out-of-viewport elements. Centered container, two-column hero/services breakpoints, aligned panels and readable uptime metrics. Screenshot `/tmp/ui-verify/status-real-1440.png`; verifier browser terminated.
- Login at 1440×1000 on Docker frontend passed (`gentle-ai-verify`): `/login` document/assets 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 1440. Hero/auth card aligned, controls and links readable and unclipped; decorative rings contained. Screenshot `/tmp/ui-verify/login-real-1440.png`; no forms submitted; verifier browser terminated.
- Register at 1440×1000 on Docker frontend passed (`gentle-ai-verify`): `/register` document/assets 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 1440, zero out-of-viewport elements. Six fields, password icons, two-column name row, buttons and footer links aligned and unclipped; expected vertical scrolling (1018px page height). Screenshot `/tmp/ui-verify/register-real-1440.png`; no forms submitted; verifier browser terminated.
- Login at 320×812 on Docker frontend passed (`gentle-ai-verify`): document/assets 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 320. No unclipped content outside viewport; decorative rings correctly clipped. Fields/buttons retain 44px height; credentials and links wrap cleanly. Screenshot `/tmp/ui-verify/login-real-320.png`; no forms submitted; verifier browser terminated.
- Register at 320×812 on Docker frontend passed (`gentle-ai-verify`): document/assets 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 320. No unclipped content outside viewport; decorative rings correctly contained. Name fields stack, six labeled inputs/password icons and buttons fit; controls retain 44px height and footer wraps cleanly. Screenshot `/tmp/ui-verify/register-real-320.png`; no forms submitted; verifier browser terminated.
- Real demo Monitors at 320×812 passed (`gentle-ai-verify`): demo-login and monitors 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 320, zero out-of-viewport elements. Header wraps user/logout to second row; metrics/form/list/footer remain contained. Inputs 44px high; create button 40px and delete controls 30px (not claimed as universal 44px touch targets). Screenshot `/tmp/ui-verify/monitors-real-320.png`; no monitors created/deleted; verifier browser terminated.
- Real public Status at 320×812 passed (`gentle-ai-verify`): `/api/v1/public/status` 200 with populated service data; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 320, zero out-of-viewport elements. Brand/sign-in, overall pill, service name/status, uptime/timestamp and footer wrap without collision. Screenshot `/tmp/ui-verify/status-real-320.png`; verifier browser terminated.
- Real demo Monitor history at 320×812 passed (`gentle-ai-verify`): dynamically discovered `/monitors/20266`; demo-login/monitors/history/alerts all 200; zero console errors/warnings/unhandled exceptions; html/body scrollWidth = clientWidth = 320, zero uncontained overflow. Two-column summary and SVG contained; 680px table scroll limited to 244px inner wrapper, not page. Screenshot `/tmp/ui-verify/history-real-320.png`; verifier browser terminated.
- Browser checks completed at 1440px and 320px for all five screens, plus earlier 375px checks (Login/Register preview, Monitors/history/public Status real stack). No cross-browser or exhaustive interaction/accessibility audit claimed.
- Final delegated structural readback passed against `b15a659` at source HEAD `83b3306c4271434bca3c6f2f322c0b9af65a2734`: 16 changed TSX components follow the token-based design language. Intentional variants include public hero `sm:text-5xl`, history section `text-xl sm:text-2xl`, compact metric padding and 11px monitor metadata labels.
- AST comparison with className attributes/location metadata stripped: 12 of 17 source/test files identical. Other deltas reviewed: style-string constants in Button/StatusPill/Register, three MonitorList test class assertions, and one aria-hidden decorative status dot. No hook/API/handler/validation/routing changes found. Structural evidence is not an absolute proof against all behavioral regressions.
- `globals.css` blob hash identical at base/HEAD/worktree (`9c34c756e72688b6c3822d389cf866af98c29094`); parent repeated base/HEAD/worktree preservation check successfully.
- `git diff --check b15a659 HEAD` and worktree check passed; parent repeated worktree check after verification. Worktree intentionally not clean: task record modified, six preexisting tracked screenshot deletions and untracked ZIP preserved.
- Docker final read-only state: DB/API healthy, frontend/worker running. Stack left up at `http://localhost:5173`; no container shutdown or volume removal.
- Verification complete; no pending required functional checks. Limitations: Chromium headless only, sampled viewports/data states; no exhaustive cross-browser/accessibility audit or account creation/deletion exercise. RDD is clone-local off; no native review run or switch change.
- Evidence-only task record is uncommitted; no new commit, push, PR or merge in this verification continuation.
- No source edits, new commits, push, or PR during resumed verification. Preserve deleted tracked screenshots and untracked ZIP.
