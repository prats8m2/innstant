# The Kesari — design spec

Extracted from `kesari-guest-app.html` by `pnpm design:decode`. **This file is
the spec.** The export is a compiled bundle and is not readable as shipped —
which is why the first pass at it wrongly concluded there was nothing to
extract.

There is no token pipeline and no `tokens.json` (D-023). These values live in
`src/styles/theme.css` as CSS custom properties, hand-maintained, and
components reference the variables rather than the literals — so a second hotel
is still a palette swap and not a fork (D-016).

---

## Palette

| Variable | Value | Role |
|---|---|---|
| `--ink-900` | `#08101C` | deepest ground |
| `--ink-850` | `#0A1220` | page background |
| `--ink-800` | `#101E33` | primary surface — the indigo the property is built on |
| `--ink-700` | `#16253E` | raised surface |
| `--ink-600` | `#1B2B45` | card |
| `--ink-500` | `#22354F` | card, hovered |
| `--ink-450` | `#223353` | divider-on-card |
| `--ink-400` | `#243755` | border |
| `--ink-300` | `#4A5A73` | muted text |
| `--saffron` | `#E9A227` | primary accent, links, the cart pill |
| `--saffron-lit` | `#F2B84B` | accent hover / active |
| `--plaster` | `#E3E5DB` | primary text — lime plaster, not white |
| `--teal` | `#6E9C95` | secondary accent, "open" states |

Deep indigo ground with saffron. **Not** cream-and-terracotta, which is what
the brief explicitly ruled out.

## Type

Self-hosted, all three are Google Fonts under the SIL Open Font License —
commercial use is permitted, which matters because a hotel deployment is
commercial use.

| Variable | Family | Use |
|---|---|---|
| `--font-display` | **Marcellus** | headings, dish names, the property name |
| `--font-body` | **Mukta** | body copy, labels, buttons |
| `--font-mono` | **DM Mono** | prices, room numbers, order refs, folio figures |

DM Mono carries the tabular-figure requirement (#5): money must not jitter as
digits change.

## Shape

Radii are deliberately **sharp** — `2px`, `3px`, `4px`. This is the single
strongest signal that the design is not stock shadcn (which is 8px everywhere).
The only round things are pills: `17px` and `22px`.

## Motion

| Variable | Value |
|---|---|
| `--dur-fast` | `180ms` |
| `--dur-base` | `200ms` |
| `--dur-mid` | `240ms` |
| `--dur-slow` | `300ms` |
| `--dur-slower` | `320ms` |

Everything sits in the 180–320ms band the brief specified. Named keyframes in
the export: `riseIn`, `archIn`, `shimmer`, `flow`, `breathe`, `sweep`, `glow`.

`prefers-reduced-motion` is handled **once, globally**, collapsing every
animation and transition to 1ms — not per-component.

## Screens

Eight, all present in the export:

`home` · `menu` · `dish` · `track` · `amenities` · `service` · `stay` · `nearby`

Room home rows, verbatim from the export:

| Title | Sub |
|---|---|
| Amenities | Towels · laundry · transfer |
| Call for service | Someone comes up |
| Your stay | Out Thursday, 11am |
| Nearby | Seven places we vouch for |

The voice is worth preserving exactly. It is specific and unapologetic —
"Seven places we vouch for", "He is at your door.", "Plated. The window is as
tight as it gets." Copy is part of the design, not filler.

## Viewport

390 × 844. Mobile only, no desktop breakpoint. Primary actions in the bottom
40% — one thumb.
