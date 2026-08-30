import type { Config } from 'tailwindcss';

/**
 * The theme extension is DELIBERATELY EMPTY.
 *
 * S2b generates it from `design/tokens/tokens.json` via `pnpm tokens:build`.
 * Do not add a colour, radius, font or duration here by hand — CLAUDE.md
 * "Design tokens are the only source of colour, radius, type, and motion
 * values." Stock shadcn/Tailwind defaults are explicitly not the design.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
