# 10 — Design system (binding for every screen)

This is the built implementation of docs/06. Read it before touching any UI file.

## The idea

**The register, not the newspaper.** The visual world is the ruled account register:
ledger paper, indigo ink, brass. A page is a stack of ruled bands, each one a record
with its label at the left and its figures right-aligned.

**The signature is the pace track.** Two positions on one axis: where the calendar
had reached, and how much of the allocation had been spent by that date. The gap
between them is the whole product. It renders at three sizes (`hero`, `default`,
`chip`) so the same motif carries from the national headline down to a table row.
Spend your boldness there and keep everything else quiet.

## Hard rules

1. **No emoji anywhere.** Icons come from `lucide-react` and go through `<Icon>`
   (`components/icon.tsx`). Never import a Lucide component directly into a page.
2. **No em-dashes or en-dashes** in any user-facing string. Commas, full stops, or
   restructure. Enforced by `src/lib/strings.test.ts`.
3. **No version references** in any user-facing surface. No "beta", no build strings.
4. **Every user-facing string lives in `src/lib/strings.ts`.** Add to the dictionary;
   never inline a literal in JSX.
5. **Every money figure renders through `<Figure>`** (`components/figure.tsx`) with its
   `provenance`, `metric` and `entityId`. A number without a source affordance is a bug.
6. **A missing figure is `NOT_REPORTED`, never 0.** Use the helpers in `@nidhi/core`
   (`subtract`, `percentOf`, `ratio`) which propagate absence instead of coercing it.
7. **Every chart goes through `<Chart>`** (`components/chart.tsx`), which supplies the
   theme, the mandatory data-table fallback, and the typed interaction event.
8. **Every interactive component fires a typed event** via `track()` from
   `@/lib/analytics`. Raw string event names are forbidden; the union in
   `@nidhi/core/analytics` is the whole taxonomy.
9. **No rounded corners beyond 2px, no drop shadows on content, no cards.** Rules
   separate records. Shadows appear only on popovers and dropdowns that float.
10. **Hatching means uncertainty**, systemwide: provisional months, gaps in a
    series, and the unspent or overspent region of the pace track. Never decorative.

## Tokens

Defined in `src/app/globals.css` under `@theme`. Use the CSS variables, never a raw hex.

| Role | Variable |
|---|---|
| Surfaces | `--color-paper`, `--color-paper-raised`, `--color-paper-sunk` |
| Ink | `--color-ink`, `--color-ink-soft`, `--color-ink-faint` |
| Rules | `--color-rule`, `--color-rule-strong` |
| Behind pace | `--color-behind`, `--color-behind-soft` |
| In step | `--color-onpace` |
| Ahead of pace | `--color-ahead`, `--color-ahead-soft` |
| Provenance and signals only | `--color-seal` |
| Absence | `--color-unreported` |

The pace axis is indigo to brass, deliberately not red to green: behind pace is not a
scandal and ahead of pace is not success, and blue against yellow is the safest axis
for colour vision deficiency. `burnColor()` in `@nidhi/core` is the only source of a
pace colour. Vermilion (`--color-seal`) is reserved for provenance triggers, signal
markers and focus rings; the moment it decorates anything, it stops meaning anything.

## Type

Three roles, one superfamily (IBM Plex, chosen because it carries Devanagari in all
three and the Hindi interface will need it).

| Role | Class | Used for |
|---|---|---|
| Display | `.font-display` | Headings, the wordmark |
| Label | `.eyebrow` | Uppercase field labels, from government form vernacular |
| Data | `.figure` | Every rupee figure, tabular, ledger-aligned |
| Prose | `.prose-civic` | Methodology, AI narratives, long copy |

Body copy is the UI sans. Prose is the serif. Figures are always mono.

## Primitives

From `components/layout-primitives.tsx`: `PageShell`, `PageHeader`, `Section`, `Band`,
`EmptyState`, `Callout`, `TableScroll`, `Chip`. Tables use the `.data-table` class with
`.num` on figure columns. Compose these rather than inventing a parallel set.

## Copy voice

Plain verbs, sentence case, no filler. Describe, never accuse: the words banned by
docs/08 (`scam`, `fraud`, `siphoned`, `corrupt`) are asserted against in tests. Empty
states are an invitation to act, not an apology. Errors say what happened and what to
do next. An action keeps its name through the whole flow.

Never imply a live treasury feed. "Live" means as fresh as the sources allow, and the
interface says so.

## Motion

One orchestrated page-load reveal on the pace track (`.animate-track`,
`.animate-marker`) and nothing else. `prefers-reduced-motion` is honoured globally in
`globals.css`; do not add animation that bypasses it.

## Quality floor

Responsive to 360px, visible keyboard focus, charts have data-table fallbacks, colour
is never the only channel, tables scroll horizontally rather than squeezing. Journalists
read this on phones.
