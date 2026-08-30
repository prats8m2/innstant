import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  // Migrations run as the OWNER role, never app_user. CLAUDE.md #2.
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? '',
    ssl: { rejectUnauthorized: false },
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
