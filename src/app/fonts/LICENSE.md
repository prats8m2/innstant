# Fonts

All seven faces are licensed under the SIL Open Font License 1.1, which permits
bundling and self-hosting. Latin subsets, taken from the Google Fonts CDN and
committed here so the app never makes a runtime request to fonts.gstatic.com
(see `src/app/fonts.ts`).

There are five because there are two type systems: the product's (Marcellus,
Mukta, DM Mono — the guest app, the console and the floor screens since D-100)
and the marketing site's (D-062).

## The product — guest app, console and floor screens

| File | Family | Weights | Upstream |
|---|---|---|---|
| `marcellus-400.woff2` | Marcellus | 400 | [Marcellus](https://fonts.google.com/specimen/Marcellus) — Brian J. Bonislawsky |
| `mukta-400/500/600/700.woff2` | Mukta | 400, 500, 600, 700 | [Mukta](https://fonts.google.com/specimen/Mukta) — Ek Type |
| `dm-mono-400/500.woff2` | DM Mono | 400, 500 | [DM Mono](https://fonts.google.com/specimen/DM+Mono) — Colophon Foundry |
| `cormorant-garamond-var.woff2`, `cormorant-garamond-italic-var.woff2` | Cormorant Garamond | `wght 400–600`, italic `400–500` | [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) — Christian Thalmann (Catharsis Fonts) |
| `manrope-var.woff2` | Manrope | `wght 400–700` | [Manrope](https://fonts.google.com/specimen/Manrope) — Mikhail Sharanda |

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
