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
  listRoomsAtProperty, liveQrCodesForProperty, listRoomTypes, listRoomTypesWithUse,
} from './rooms';
export { listRolesAtProperty } from './roles';
export type { PropertyRole } from './roles';
export type {
  RoomRef, PropertySettings, FloorRef, RoomDescription, RoomListing, RoomQrCode,
  RoomTypeOption, RoomTypeListing,
} from './rooms';

export { provisionProperty, provisionTenant } from './provision';
/** One generator for every public code in the product — a room sticker and a
 *  property link are the same question about guessability (D-079). */
export { newPublicCode } from './provision';

/** P3.5 — the building: floors and the rooms on them. */
export {
  createFloor, renameFloor, deleteFloor,
  createRoom, updateRoom, archiveRoom, restoreRoom,
  createRoomType, updateRoomType, archiveRoomType, restoreRoomType,
  regenerateQrCode,
} from './property-setup';
export type { FloorInput, RoomInput, CreatedRoom, RoomTypeInput } from './property-setup';

/** P3.5 — staff, their roles here, and the link that gives them a password. */
export {
  listStaffAtProperty, inviteStaff, reissueInvite, describeInvite, acceptInvite,
  updateStaff, deactivateStaff, reactivateStaff, assignRole, revokeRole,
} from './staff';
export type { StaffMember, InviteInput, IssuedInvite, InviteDetails } from './staff';

/** P3.5 — the hotel's own name, timezone and currency. */
export { updatePropertySettings, currencyIsStillOpen } from './property-settings';
export type { PropertySettingsInput } from './property-settings';

/** D-087 — what a guest reads about the hotel, and how it looks to them. */
export { getPropertyProfile, updateGuestInfo, updateBranding } from './property-profile';
export type { PropertyProfile } from './property-profile';
export { cleanGuestInfo, dialable } from './guest-info';
export type { GuestInfo } from './guest-info';
export {
  readBranding, cleanBranding, brandingStyle, accentContrast, NO_BRANDING, BRAND_PRESETS,
} from './branding';
export type { PropertyBranding, AccentContrast } from './branding';
export type {
  ProvisionPropertyInput, ProvisionedProperty, RoomSeed, RoomTypeSeed, FloorSeed,
} from './provision';
