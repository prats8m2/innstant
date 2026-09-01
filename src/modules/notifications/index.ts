/**
 * The notifications module's service interface.
 *
 * It owns `notifications` (D-001). Anything that wants to tell somebody
 * something queues a row through here; nothing else touches the table.
 *
 * IN_APP is delivered — `deliverInApp()` is the drainer and the bell is the
 * screen. The outside channels are still rows and nothing more; see queue.ts.
 */
export {
  queueNotifications, notificationsFor, unacknowledgedCount, acknowledgeAll,
  deliverInApp, NOTIFICATION_CHANNEL,
} from './queue';
export type { QueuedNotification, StaffNotification, StaffNotifiedPayload } from './queue';
export { renderNotification } from './templates';
export type { RenderedNotification, NotificationContent } from './templates';
