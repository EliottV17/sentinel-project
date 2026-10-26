---
name: Sentinel
description: A quiet, dark monitoring interface built for continuous operational observation.
colors:
  canvas: "#090e13"
  surface: "#101820"
  raised: "#151e26"
  line: "#29343b"
  line-strong: "#34424a"
  ink: "#c5c9c7"
  muted: "#a4a7a4"
  subtle: "#747d7c"
  accent: "#8ea4a2"
  accent-strong: "#8ba4b0"
  accent-soft: "#1c2b31"
  success: "#8a9a7b"
  success-soft: "#202b25"
  warning: "#c4b28a"
  warning-soft: "#302b21"
  danger: "#c4746e"
  danger-strong: "#b96561"
  danger-soft: "#392523"
typography:
  display:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: "2rem"
  heading:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: "1.5rem"
  body:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: "0.9375rem"
  caption:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: "0.75rem"
  label:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  control:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  status:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
rounded:
  panel: "0.875rem"
  control: "0.625rem"
spacing:
  page: "clamp(1rem, 4vw, 2rem)"
  section: "2rem"
  panel: "1.5rem"
  control: "0.75rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "0.625rem 1rem"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
  button-danger:
    backgroundColor: "{colors.danger-strong}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "0.625rem 1rem"
    typography: "{typography.label}"
  button-danger-hover:
    backgroundColor: "{colors.danger}"
  button-demo:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.75rem"
    width: "100%"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.75rem"
    typography: "{typography.control}"
  nav-header:
    backgroundColor: "rgb(9 14 19 / 0.8)"
    textColor: "{colors.muted}"
    padding: "1rem 1.5rem"
  status-pill-healthy:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.625rem"
    typography: "{typography.status}"
  public-status-badge:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "9999px"
    padding: "0.375rem 0.75rem"
    typography: "{typography.status}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1.25rem"
---
# Design System: Sentinel

## Overview

**Creative North Star: "The Watchkeeper’s Log"**

Sentinel is a calm, instrumental interface for continuous observation. Dark tonal layers, muted contrast, and a restrained serif-and-monospace pairing give operational information a stable hierarchy; state colors remain moderate signals rather than decoration. The voice is **Calm and instrumental**: measured, legible, and oriented around what is happening now.

**Key Characteristics:**
- Dark, layered canvas and surfaces
- Functional color names and explicit status labels
- Serif headings alongside a monospace-led interface

## Colors

A deep neutral foundation carries a muted cool accent, with restrained semantic colors for operational state.

### Primary
- **Accent:** The subdued cool highlight marks emphasis, links, and primary actions.
- **Accent Strong:** The stronger action fill distinguishes primary controls.
- **Accent Soft:** A low-contrast accent surface supports the demo button and related emphasized states.

### Neutral
- **Canvas:** The page ground and input fill.
- **Surface:** The default card and panel layer.
- **Raised:** A higher tonal layer for subdued pills and hover backgrounds.
- **Line / Line Strong:** Quiet separators and more visible control borders.
- **Ink / Muted / Subtle:** Primary text, supporting text, and placeholders or least-emphasized detail.

### Semantic
- **Success / Success Soft:** Healthy or operational status.
- **Warning / Warning Soft:** Degraded, stale, or cautionary status.
- **Danger / Danger Strong / Danger Soft:** Unhealthy state, destructive action, and its supporting surface.

Color keys and values in frontmatter are normative. Use these functional names; don't create metaphorical aliases.

## Typography

**Display Font:** Georgia (with Times New Roman, serif fallback)
**Body Font:** System monospace stack (with platform monospace fallbacks)
**Label/Mono Font:** The same system monospace stack; the composite label role uses the full source family including `"Liberation Mono"`.

**Character:** Georgia adds a restrained editorial note to headings; monospace keeps the operational interface steady and data-forward. The body stack is declared monospace, while actual text sizes are chosen locally in rendered components.

### Hierarchy
- **Display (declared 2rem):** Global `--text-display`; headings render larger locally, commonly 30px and 36px.
- **Heading (declared 1.5rem):** Global `--text-heading`; section headings commonly render at 20px and 24px.
- **Body (declared 0.9375rem):** Global `--text-body` is declared but not generally applied as the body role; observed text commonly uses 14px and 16px.
- **Caption (declared 0.75rem):** Global `--text-caption`; compact labels commonly render at 11px or 12px.
- **Label (14px/20px, 600):** Composite monospace role observed on primary and demo buttons.
- **Control (14px/20px, 400):** Composite monospace role observed on text inputs; status labels use 12px/16px semibold.
- **Metrics:** Often monospace, 20px or 24px.

These are observed examples, not a prescribed universal type scale. Source: `frontend/src/app/styles/globals.css`, `frontend/src/features/monitors/MonitorRow.tsx`, `frontend/src/features/monitors/history/MonitorHistoryPage.tsx`.

## Layout

The protected app uses a wrapping, sticky header and a centered main column capped at 64rem (`max-w-5xl`), with 1rem gutters that become 1.5rem at the `sm` breakpoint (640px). Login content is centered in a 28rem column. Cards use 1.25rem padding, increasing to 1.5rem at `sm`; page sections commonly step from 1.5rem to 2rem gaps. Monitor detail grids move from two to three columns at `sm`; public status cards use two columns at `md` (768px); the monitor-history metrics grid expands from two to four columns at `lg` (1024px). Preserve wrapping and minimum-width safeguards for dense values.

## Elevation & Depth

Depth is primarily tonal: canvas, surface, and raised layers separate content, while borders define edges. Ambient shadows reinforce panels and interactive emphasis without turning the interface into a stack of floating cards.

Global unlayered rules declare 160ms `ease` transitions for color, background color, border color, box shadow, and opacity on buttons, inputs, and links. Those declarations take precedence over Tailwind's layered 150ms transition utilities for those properties. Transform is not in the global list, so active scaling is not smoothed by it; monitor rows have their own 200ms transition. Reduced-motion preference overrides transitions and animation durations globally.

### Shadow Vocabulary
- **Panel:** `0 18px 44px rgb(0 0 0 / 0.22)` for cards and panels.
- **Glow:** `0 0 0 1px rgb(142 164 162 / 0.12), 0 12px 30px rgb(0 0 0 / 0.2)` on highlighted primary actions and hovered monitor rows.
- **Primary/header utility shadow:** Tailwind `shadow-sm` resolves to `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` on the shared primary button and app header.

## Shapes

Panels have gently rounded corners (0.875rem); controls use a tighter radius (0.625rem). Borders are thin and tonal. Status pills use the control radius in the protected UI, while public status badges are fully capsule-shaped (9999px equivalent). Avoid treating these distinct variants as one universal shape.

## Components

### Buttons
Discreet, compact instruments with explicit intent. The shared `Button` supports primary and danger variants: control radius, 14px/20px semibold text, and `0.625rem 1rem` padding. Primary hover shifts to the accent and glow; danger hover shifts to the danger color. Demo access is a separate feature-local secondary treatment with accent-soft fill and accent text. Active scales to 0.98; focus has an accent ring at 40% opacity. Disabled buttons reduce opacity and suppress active scaling. Buttons and links inherit the global 160ms transition for listed properties; transform is not included. Shared button utilities request no outline and a 2px accent ring at 40% opacity. The unlayered global focus-visible rule takes precedence over the layered outline utility, adding a 2px accent outline with 3px offset alongside the component ring. Feature-local examples such as login and monitor creation use 44px control heights; this is not a shared minimum.

### Cards / Containers
Use surface fill, a quiet border, panel radius, and panel shadow. Standard padding is 1.25rem, expanding to 1.5rem on wider layouts.

### Inputs / Fields
The shared input uses canvas fill, strong line border, control radius, 14px/20px text, and `0.625rem 0.75rem` padding. Hover and focus strengthen the accent border; focus adds a 2px accent ring at 30% opacity. Invalid fields switch to danger border and text; disabled fields dim. Inputs inherit the global 160ms transition for listed properties. Input focus styling uses `:focus` (not only `:focus-visible`) and a 2px accent ring at 30% opacity; the global focus-visible outline is also declared. Feature-local examples such as login and monitor-creation fields are 44px high.

### Navigation
The app header is sticky and wraps: brand at one side, account/logout controls at the other. It uses an 80%-opaque canvas layer, 12px blur, bottom border, and compact control treatment; horizontal padding grows from 1rem to 1.5rem at `sm`. The inline Sentinel lockup includes a 32px icon and Georgia serif wordmark at 20px. The logout action is normal-weight and non-wrapping. Public status and login have sign-in/back links; there are no tab-style navigation states. Header controls use accent-border or text emphasis on hover and a 2px accent focus ring at 40% opacity. The unlayered global focus-visible rule adds a 2px accent outline with 3px offset alongside the layered component ring.

### Status Pills
Status badges are non-interactive labels, not controls. Protected monitor states use the control radius; public status badges use a capsule shape. Pair each moderate semantic treatment with explicit text labels; healthy, warning/degraded, danger/down, and no-data states have distinct surface, border, and text roles.

### Monitor Rows
Monitor rows are surface cards with panel radius, border, and panel shadow. Hover lifts the row by 2px and applies the glow; content uses a compact two-to-three-column detail grid with monospace target and metric values.

## Do's and Don'ts

### Do:
- **Do** use the frontmatter's functional color names and preserve explicit semantic status labels.
- **Do** retain the serif-heading / monospace-interface contrast and the tonal layering of the dark surfaces.
- **Do** treat shared `Button`, `Input`, and `Card` as primitives while honoring feature-local differences.

### Don't:
- **Don't** assume every control has a 44px minimum height; 44px appears in feature-local examples such as login and monitor creation.
- **Don't** turn status pills into interactive controls or communicate state through color alone.
- **Don't** invent tab navigation, a light theme, or external font loading; none is present in the current implementation.
