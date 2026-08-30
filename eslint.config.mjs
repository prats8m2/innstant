import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

/**
 * Module boundaries (D-001, EXTENSION-POINTS §A).
 *
 * Each `src/modules/<name>/` owns its tables. A module's schema file is
 * importable ONLY from that module and from `src/db/**`. Everything else calls
 * the module's service function.
 *
 * The boundary is enforced by lint because it is not enforced by the network —
 * that is the tax of a modular monolith (D-001), and it is the whole reason
 * `ordering` can be extracted later without an archaeology project.
 *
 * ORDER MATTERS. Flat config resolves a rule to the LAST matching block, so the
 * per-module overrides must come after the global block or a module loses the
 * ability to import its own tables. There is a probe for exactly this in
 * `tests/lint-boundary.test.ts` — it is not a hypothetical mistake.
 */
const MODULES = [
  'identity', 'stay', 'catalog', 'ordering', 'requests',
  'housekeeping', 'concierge', 'billing', 'notifications', 'access',
];

const NO_SECOND_POOL =
  'Only src/db may open a database connection. Import withTenant() from ' +
  '@/db — a second pool would bypass the tenant context that the RLS ' +
  'policies read (CLAUDE.md #1).';

const TABLES_ARE_PRIVATE =
  'Tables are module-private (D-001). Import the owning module\'s service ' +
  'interface, not src/db/schema.';

const STAYS_ARE_SEALED =
  'Only modules/stay may touch `stays` (CLAUDE.md #4, EXTENSION-POINTS §A). ' +
  'Every stay in the system is created by createStay(); call it.';

const schemaGroup = (names) =>
  names.flatMap((m) => [`**/db/schema/${m}`, `@/db/schema/${m}`]);


/** Inside module <name>: its own tables are fine, everyone else's are not. */
const moduleBoundaries = MODULES.map((name) => {
  const others = MODULES.filter((m) => m !== name);
  return {
    files: [`src/modules/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', {
        // Repeated from the global block: flat config resolves a rule to the
        // LAST matching entry, replacing it wholesale rather than merging, so
        // omitting these here would silently un-ban them inside every module.
        paths: [
          { name: 'pg', message: NO_SECOND_POOL },
          { name: 'drizzle-orm/node-postgres', message: NO_SECOND_POOL },
        ],
        patterns: [
          ...(name === 'stay' ? [] : [{
            group: schemaGroup(['stay']),
            message: STAYS_ARE_SEALED,
          }]),
          {
            group: schemaGroup(others.filter((m) => m !== 'stay')),
            message: TABLES_ARE_PRIVATE,
          },
        ],
      }],
    },
  };
});

export default tseslint.config(
  {
    ignores: [
      '.next/**', 'node_modules/**', 'next-env.d.ts',
      // Derived from the design export by `pnpm design:decode` — vendored
      // React/runtime bundles, never edited, never shipped.
      'design/reference/decoded/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // Global default: nothing may reach into the schema. Overridden below for
  // src/db (which owns it) and for each module (its own tables only).
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'pg', message: NO_SECOND_POOL },
          { name: 'drizzle-orm/node-postgres', message: NO_SECOND_POOL },
        ],
        patterns: [
          { group: schemaGroup(['stay']), message: STAYS_ARE_SEALED },
          {
            group: ['**/db/schema/*', '@/db/schema/*'],
            // D-019 — core.ts is exempt: every module writes event_log in its
            // own transaction (#7), so scoping it to one module would break
            // either #7 or D-001. Prefer recordEvent(tx, ...) from
            // src/db/events.ts; the helper is what keeps the write in the
            // SAME transaction as the status change, which is #7's real
            // requirement and is not something the lint rule can enforce.
            message: TABLES_ARE_PRIVATE,
          },
        ],
      }],
    },
  },

  // src/db owns the schema and the pool, and may import all of it.
  //
  // `scripts/**` is exempt for a narrower reason: those are operational tools
  // that run outside the request lifecycle and sometimes must test the raw
  // connection itself — check-pooler.ts exists precisely to assert things about
  // a connection that withTenant() would hide. Nothing under scripts/ serves a
  // guest request, so the tenant-leak risk the rule guards against does not
  // apply. Do NOT widen this to src/app or src/modules.
  //
  // `tests/integration/**` is exempt for the sharpest reason of all: those
  // tests must connect as raw app_user WITHOUT withTenant, because proving
  // that an unscoped query returns zero rows is impossible through a helper
  // that always scopes. The rule would forbid the very test that proves the
  // rule is not the thing keeping us safe.
  {
    files: ['src/db/**/*.ts', 'scripts/**/*.ts', 'tests/integration/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // Must come last — see the ORDER MATTERS note above.
  ...moduleBoundaries,
);
