# Fonts

Both faces are licensed under the SIL Open Font License 1.1, which permits
bundling and self-hosting. Latin subsets, taken from the Google Fonts CDN and
committed here so the app never makes a runtime request to fonts.gstatic.com
(see `src/app/fonts.ts`).

| File | Family | Axes | Upstream |
|---|---|---|---|
| `public-sans-var.woff2` | Public Sans | `wght 100–900` | [Public Sans](https://fonts.google.com/specimen/Public+Sans) — US General Services Administration |
| `red-hat-mono-var.woff2` | Red Hat Mono | `wght 300–700` | [Red Hat Mono](https://fonts.google.com/specimen/Red+Hat+Mono) — Red Hat, Inc. |

## The unused files

`marcellus-400.woff2`, `mukta-*.woff2` and `dm-mono-*.woff2` are the Kesari
faces the indigo palette used before D-048. Nothing imports them. They are kept
so that reverting the palette is a change to `theme.css` and `fonts.ts` rather
than a download. They are SIL OFL 1.1 as well — see `design/fonts/LICENSE.md`.
