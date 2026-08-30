/**
 * The stay module's service interface.
 *
 * `stays` is sealed (CLAUDE.md #4, EXTENSION-POINTS §A): the ESLint boundary
 * forbids every other module from importing the table, and this file is the
 * only way in. `createStay()` is the single birth certificate — front desk,
 * PMS import and the seeder all call it, and booking becomes a fourth caller
 * rather than a sixth code path.
 */
export {
  createStay, activeStayForRoom, dietaryFlagsForStay, countActiveStays,
} from './create-stay';
export type { CreateStayInput, CreatedStay } from './create-stay';
