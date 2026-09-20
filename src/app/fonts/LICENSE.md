# Fonts

All seven faces are licensed under the SIL Open Font License 1.1, which permits
bundling and self-hosting. Latin subsets, taken from the Google Fonts CDN and
committed here so the app never makes a runtime request to fonts.gstatic.com
(see `src/app/fonts.ts`).

There are seven because there are three design systems (D-050, D-062), and they
are not variants of one another: a guest is being hosted, a cook is being
informed, and a stranger is being persuaded.

## The staff console — `:root`

| File | Family | Axes | Upstream |
|---|---|---|---|
| `public-sans-var.woff2` | Public Sans | `wght 100–900` | [Public Sans](https://fonts.google.com/specimen/Public+Sans) — US General Services Administration |
| `red-hat-mono-var.woff2` | Red Hat Mono | `wght 300–700` | [Red Hat Mono](https://fonts.google.com/specimen/Red+Hat+Mono) — Red Hat, Inc. |

## The guest app — `[data-theme='kesari']`

| File | Family | Weights | Upstream |
|---|---|---|---|
| `marcellus-400.woff2` | Marcellus | 400 | [Marcellus](https://fonts.google.com/specimen/Marcellus) — Brian J. Bonislawsky |
| `mukta-400/500/600/700.woff2` | Mukta | 400, 500, 600, 700 | [Mukta](https://fonts.google.com/specimen/Mukta) — Ek Type |
| `dm-mono-400/500.woff2` | DM Mono | 400, 500 | [DM Mono](https://fonts.google.com/specimen/DM+Mono) — Colophon Foundry |

These were briefly unused: D-048 replaced the palette product-wide with the
console's, and D-050 gave the guest app its own theme back. The three families
are load-bearing again, and DM Mono is the one family all three themes share.

## The marketing site — `[data-theme='innstant']`

| File | Family | Axes | Upstream |
|---|---|---|---|
| `instrument-serif-400.woff2` | Instrument Serif | 400 | [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) — Rodrigo Fuenzalida, Jordan Egstad |
| `figtree-var.woff2` | Figtree | `wght 300–900` | [Figtree](https://fonts.google.com/specimen/Figtree) — Erik Kennedy |

`latin` only, deliberately: the site is in English, and the `latin-ext` files are
five kilobytes each of accents nothing on the page renders. `next/font` emits a
preload only for the families a given route actually uses, so a guest's phone
never downloads the site's two and the site never downloads the console's.
