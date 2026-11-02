/**
 * The housekeeping module's service interface.
 *
 * It owns `shifts` and `shift_zones` (D-001). Routing asks it who is on duty and
 * covering a floor; the board asks it what shift the person holding the phone is
 * on. Nothing else touches those tables.
 */
export {
  clockIn, clockOut, getCurrentShift, onDutyCovering, onDutyCount, listOnShift, endShiftFor,
} from './shifts';
export type { StaffShift, ShiftZone, OnDutyStaff, OnShift } from './shifts';

/** Is an empty room ready for the next guest (D-096). */
export { roomCleanStates, cleanStateOf, setRoomCleanStatus, ROOM_CLEAN_STATUSES } from './room-status';
export type { RoomCleanStatus, RoomCleanState } from './room-status';
