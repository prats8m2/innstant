/**
 * The identity module's service interface.
 *
 * Other modules import from HERE, never from `@/db/schema/identity` — a
 * module's tables are its own (D-001), and the boundary lint rule enforces it.
 */
export { login, setStaffPassword, loginInputSchema, LOGIN_FAILED_MESSAGE } from './login';
export type { LoginInput, LoginContext } from './login';

export {
  resolveStaffSession, revokeStaffSession, revokeAllSessionsFor, createStaffSession,
} from './sessions';
export { STAFF_SESSION_COOKIE, SESSION_COOKIE_OPTIONS, SESSION_TTL_HOURS } from './cookie';
export type { IssuedSession } from './sessions';

export { authorize, can, requireSession, visibleProperties } from './authorize';
export type { StaffSession } from './authorize';

export {
  PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, permissionsForRole, isPermission,
} from './permissions';
export type { Permission, SystemRoleKey, SystemRole } from './permissions';

export { seedSystemRoles } from './seed-roles';

export {
  findRoomAtProperty, findRoomByNumber, findProperty, listFloors, describeRoom,
} from './rooms';
export { listRolesAtProperty } from './roles';
export type { PropertyRole } from './roles';
export type { RoomRef, PropertySettings, FloorRef, RoomDescription } from './rooms';

export { provisionProperty, provisionTenant } from './provision';
export type {
  ProvisionPropertyInput, ProvisionedProperty, RoomSeed, RoomTypeSeed, FloorSeed,
} from './provision';
