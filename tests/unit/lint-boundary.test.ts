import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

/**
 * P0-TASKS S1 asks for a deliberately-failing example so the boundary rule can
 * be verified by hand. A test is better: the rule's correctness depends on
 * flat-config block ORDER, and getting that order wrong silently forbids a
 * module from importing its own tables — which looks like a working boundary
 * until someone tries to write real code.
 */
const eslint = new ESLint({ cwd: process.cwd() });

async function errorsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

describe('module boundary lint rule', () => {
  it('lets a module import its OWN tables', async () => {
    const errors = await errorsFor(
      'src/modules/ordering/service.ts',
      `import { orders } from '@/db/schema/ordering';\nexport const x = orders;\n`,
    );
    expect(errors).toEqual([]);
  });

  it("blocks a module from importing ANOTHER module's tables", async () => {
    const errors = await errorsFor(
      'src/modules/ordering/service.ts',
      `import { menuItems } from '@/db/schema/catalog';\nexport const x = menuItems;\n`,
    );
    expect(errors.join(' ')).toMatch(/module-private/);
  });

  it('seals `stays` behind modules/stay — CLAUDE.md #4', async () => {
    const errors = await errorsFor(
      'src/modules/billing/service.ts',
      `import { stays } from '@/db/schema/stay';\nexport const x = stays;\n`,
    );
    expect(errors.join(' ')).toMatch(/createStay/);
  });

  it('lets modules/stay import its own tables', async () => {
    const errors = await errorsFor(
      'src/modules/stay/create-stay.ts',
      `import { stays } from '@/db/schema/stay';\nexport const x = stays;\n`,
    );
    expect(errors).toEqual([]);
  });

  it('blocks UI components from reaching the schema at all', async () => {
    const errors = await errorsFor(
      'src/components/order-card.ts',
      `import { orders } from '@/db/schema/ordering';\nexport const x = orders;\n`,
    );
    expect(errors.join(' ')).toMatch(/module-private/);
  });

  it('blocks a route handler from reaching the schema', async () => {
    const errors = await errorsFor(
      'src/app/api/health/route.ts',
      `import { orders } from '@/db/schema/ordering';\nexport const x = orders;\n`,
    );
    expect(errors.join(' ')).toMatch(/module-private/);
  });

  it('allows src/db to import everything it owns', async () => {
    const errors = await errorsFor(
      'src/db/client.ts',
      `import { stays } from '@/db/schema/stay';\nimport { orders } from '@/db/schema/ordering';\nexport const x = [stays, orders];\n`,
    );
    expect(errors).toEqual([]);
  });
});
