/**
 * The housekeeping module's service interface.
 *
 * It owns `shifts` and `shift_zones` (D-001). Routing asks it who is on duty and
 * covering a floor; the board asks it what shift the person holding the phone is
 * on. Nothing else touches those tables.
 */
export { clockIn, clockOut, getCurrentShift, onDutyCovering, onDutyCount } from './shifts';
export type { StaffShift, ShiftZone, OnDutyStaff } from './shifts';
