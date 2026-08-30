# Design assets

This folder is the **source of truth for how the product looks**. Code never
hardcodes a colour, radius, font or duration — it reads generated output from
here.

```
design/
  reference/
    kesari-guest-app.html   the compiled Claude Design export — the reference
    DESIGN-SPEC.md          palette, type, shape, motion, screens, copy
    decoded/                `pnpm design:decode` output (git-ignored)
    room-home.png         rendered screens from Claude Design
    room-home.html        the HTML export, if you have it — reference only
    menu.png  dish-detail.png  cart.png ...
    motion-notes.md       transitions that a static image can't carry
  fonts/
    *.woff2               self-hosted faces + LICENSE for each
  design-prompts.md       the prompts that produced all of this
  theme-showcase-prompt.md
```

## How this reaches the code

```
design/reference/kesari-guest-app.html    the compiled export (the reference)
        │  pnpm design:decode
        ▼
design/reference/decoded/app.html         readable markup + stylesheet
design/reference/decoded/*.woff2          the three fonts
        │  read by hand, written up in
        ▼
design/reference/DESIGN-SPEC.md           palette, type, shape, motion
        │  hand-maintained as
        ▼
src/styles/theme.css                      CSS custom properties on :root
```

There is **no token pipeline** — no `tokens.json`, no schema, no
`pnpm tokens:build`, no generated files. See D-023. `theme.css` is written and
edited by hand, and components reference `var(--saffron)` rather than a hex, so
a second hotel is still a palette swap (D-016).

## Rules

- **`reference/` is reference, not source.** Do not copy markup out of the HTML
  export into components. It was produced to show what the design is, not how to
  build it. Rebuild it properly with the token system and real components.
- **Themes differ only in custom-property values.** Identical DOM across all of
  them. There is no schema validating that a theme defines every variable —
  that check moves into the admin theme editor in P5 (D-023). The
  one permitted structural variance is the `heroStyle` token, which has exactly
  three allowed values: `cinematic`, `editorial`, `compact`.
- **Fonts are self-hosted.** Check the licence for commercial use before adding
  one — a hotel deployment is commercial use. Put the LICENCE file next to the
  woff2.
- **Motion lives in custom properties too.** Duration and easing are variables,
  not numbers typed into a component. `prefers-reduced-motion` is handled once, in
  the motion helper, not per-animation.

## What to do when the reference and `theme.css` disagree

The reference wins. Fix `src/styles/theme.css` and say so — never special-case
the component with a one-off value.
