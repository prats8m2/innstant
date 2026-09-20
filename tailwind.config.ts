import type { Config } from 'tailwindcss';

/**
 * The theme extension is DELIBERATELY EMPTY.
 *
 * `src/styles/theme.css` is the only source of colour, radius, type and motion
 * values (CLAUDE.md). There is no token build to generate this from — D-023
 * removed it, and an earlier version of this comment sent a session looking for
 * a `pnpm tokens:build` that does not exist. Do not add a colour, radius, font
 * or duration here by hand; stock shadcn/Tailwind defaults are explicitly not
 * the design.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
