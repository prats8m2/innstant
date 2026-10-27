export { createOutlet, seedMenu, DEFAULT_IRD_HOURS } from './provision';
export {
  getMenu, getInRoomDiningMenu, getInRoomDiningOutlet, getInRoomDiningOutletConfig,
  /** D-079 — the same config for an outlet a property link names by id,
   *  and the list a link-creation screen chooses from. */
  getOutletConfig, listOutlets,
  getDish, getCartPricing, getOutletHours,
} from './menu';
export { outletOpenState, describeOpenState, isItemOnNow, hoursForDay } from './hours';
/** "Three to start with" — computed from the curated collections, never a flag. */
export { featuredDishes } from './featured';
export type { FeaturedDish } from './featured';

/**
 * Searching and filtering the menu (phase 3). Pure, over the sections
 * `getMenu()` has already assembled — see the note at the top of the file for
 * why this is not a WHERE clause.
 */
export {
  searchMenu, menuFacets, countDishes, foldForSearch, matchTier, passesFilters,
} from './menu-search';
export type {
  MenuSearchHit, MenuSearchInput, MenuFilters, MenuFacets, MatchTier,
} from './menu-search';
export type {
  OutletHoursDay, OutletOpenState, ItemAvailabilityWindow,
} from './hours';
export type {
  OutletMenu, MenuSection, MenuDish,
  DishDetail, DishModifierGroup, DishModifierOption, CartPricing,
} from './menu';
export type { OutletHoursSeed } from './provision';
export {
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_DEMO_COLLECTIONS, KESARI_MODIFIER_GROUPS,
  KESARI_ROOM_TYPES, KESARI_FLOORS, KESARI_ROOMS,
} from './kesari-menu';
export type { MenuItemSeed, ModifierGroupSeed, ModifierOptionSeed } from './kesari-menu';

/**
 * The editor's half. Everything here writes, and every write that changes what
 * a guest sees leaves an `event_log` row behind it.
 */
export {
  getAdminMenu, getAdminMenuItem, listModifierGroups,
  createMenuCategory, updateMenuCategory, archiveMenuCategory,
  createMenuItem, updateMenuItem, setMenuItemPrice, setMenuItemAvailability, listUnavailableItems,
  repriceCategory, duplicateMenuItem,
  archiveMenuItem,
  setMenuItemModifierGroups, setOutletAcceptingOrders,
  getOutletSettings, updateOutletSettings, setOutletHours,
  setMenuItemAvailabilityWindows,
  MENU_DIETARY_FLAGS,
} from './admin';
export type {
  AdminMenu, AdminMenuCategory, AdminMenuItem, AdminMenuItemDetail,
  AdminModifierGroup, MenuDietaryFlag, MenuItemWriteInput, CategoryInput,
  AdminOutletSettings, OutletSettingsInput,
} from './admin';

/** The order of sections and dishes — the menu studio's drag and drop. */
export { arrangeMenu } from './arrange';
export { planArrangement } from './arrange-plan';
export type { ArrangedSection, ArrangementPlan } from './arrange-plan';

/** Automatic offers on the menu (D-085). */
export { listOffers, createOffer, updateOffer, archiveOffer } from './admin-offers';
export type { AdminOffer, OfferWriteInput } from './admin-offers';
export { bestOffer, discountFor, offerLabel } from './offers';
export { adjustPrice } from './price-adjust';
/** "Only 20 today" (D-086). */
export {
  claimDailyPortions, releaseDailyPortions, portionsLeftToday, setDailyLimit,
} from './daily-limits';
export type { PortionLine } from './daily-limits';
export type { MenuOffer, OfferScope, OfferKind, AppliedOffer } from './offers';

/** Editorial collections — what decides how the menu reads. */
export {
  listCollections, createCollection, updateCollection, archiveCollection,
  setCollectionItems, startTodaysSpecial, addDishToCollection, TODAYS_SPECIAL,
} from './admin-collections';
export type {
  AdminCollection, AdminCollectionItem, CollectionWriteInput,
} from './admin-collections';
export { isWithinWindow, isCollectionLive, scheduleState, describeSchedule } from './hours';
export type { CollectionSchedule, ScheduleState } from './hours';

/** Modifier groups and their options — the choices a guest gets on a dish. */
export {
  listModifierGroupsForAdmin, createModifierGroup, updateModifierGroup,
  archiveModifierGroup, createModifierOption, updateModifierOption,
  archiveModifierOption,
} from './admin-modifiers';
export type {
  AdminModifierGroupDetail, AdminModifierOption,
  ModifierGroupWriteInput, ModifierOptionWriteInput,
} from './admin-modifiers';
