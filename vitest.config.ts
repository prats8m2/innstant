import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  /**
   * Compile without reading any tsconfig. `tests/unit/mobile-*.test.ts` reach
   * into `mobile/`, whose tsconfig extends `expo/tsconfig.base` — which exists
   * only once `mobile/` has its own node_modules, and CI never installs them.
   * The compiler then refused the file outright, failing the unit job on
   * every push since D-080. Stripping types needs no tsconfig; the type check
   * is `pnpm typecheck`'s job, not this one's. `tsconfig` is left out of
   * Vite's public type but passed straight through to the compiler.
   */
  oxc: { tsconfig: false } as never,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Playwright owns tests/e2e; vitest must not try to run those.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
  },
});
