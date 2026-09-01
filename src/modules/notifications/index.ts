/**
 * The notifications module's service interface.
 *
 * It owns `notifications` (D-001). Anything that wants to tell somebody
 * something queues a row through here; nothing else touches the table.
 */
export {
  queueNotifications, notificationsFor, unacknowledgedCount, acknowledgeAll,
} from './queue';
export type { QueuedNotification, StaffNotification } from './queue';
