# Design assets

This folder is the **source of truth for how the product looks**. Code never
hardcodes a colour, radius, font or duration — it reads generated output from
here.

```
design/
  tokens/
    tokens.json           canonical token set for the DEFAULT theme
    tokens.schema.json    the contract; validated in CI
  themes/
    kesari.json           one file per hotel identity, same shape as tokens.json
    aramaya.json          these are seeded into properties.branding
    node.json  ...
  reference/
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
design/tokens/tokens.json
        │  pnpm tokens:build
        ▼
src/styles/tokens.css        CSS custom properties on :root
tailwind.config.ts           theme extension reading those vars
src/lib/theme/types.ts       generated TS types
```

Never edit the generated files. Edit `tokens.json` and rerun `pnpm tokens:build`.
CI fails if the generated files are out of sync with the source.

## Rules

- **`reference/` is reference, not source.** Do not copy markup out of the HTML
  export into components. It was produced to show what the design is, not how to
  build it. Rebuild it properly with the token system and real components.
- **Every theme file has the identical key set.** A missing key is a build error,
  not a fallback. See `tokens.schema.json`.
- **Themes differ only in token values.** Identical DOM across all of them. The
  one permitted structural variance is the `heroStyle` token, which has exactly
  three allowed values: `cinematic`, `editorial`, `compact`.
- **Fonts are self-hosted.** Check the licence for commercial use before adding
  one — a hotel deployment is commercial use. Put the LICENCE file next to the
  woff2.
- **Motion lives in tokens too.** Duration and easing are token values, not
  numbers typed into a component. `prefers-reduced-motion` is handled once, in
  the motion helper, not per-animation.

## What to do when a screenshot and the tokens disagree

The tokens win. If the screenshot is right and the tokens are wrong, fix
`tokens.json` and say so — do not special-case the component.
