/**
 * The requests module's service interface.
 *
 * `request_types`, `service_requests` and `service_request_items` are private to
 * this directory (D-001). The guest screens, the staff boards and the SLA sweep
 * all come through here.
 */
export { seedDefaultRequestTypes, DEFAULT_REQUEST_TYPES } from './provision';

export { getRequestCatalog, getRequestTypeByKey, CALL_SERVICE_KEY } from './catalog';
export type { RequestTypeCard } from './catalog';

export { raiseServiceRequest, notifyRequestChanged, REQUEST_CHANNEL } from './raise-request';
export type {
  RaiseRequestInput, RaisedRequest, RequestLineInput, RequestChangedPayload,
} from './raise-request';

export {
  advanceRequest, getRequestsForStay, getRequestForStay, getOpenRequests,
} from './advance-request';
export type { AdvanceRequestInput, AdvancedRequest, RequestDetail, RequestLine }
  from './advance-request';

export {
  canTransition, nextStatuses, isTerminal, reasonRequiredFor, slaState,
  REQUEST_STATUSES, OPEN_REQUEST_STATUSES, SLA_ACTIVE_STATUSES,
} from './transitions';
export type { RequestStatus } from './transitions';

/** Auto-routing — role ∩ on-shift ∩ covers-floor, ranked by open count (§7). */
export { routeServiceRequest } from './routing';
export { pickAssignee } from './assignment';
export type { RoutingOutcome } from './routing';

/** The SLA sweep — breaches escalate on a timer, not on a page load. */
export { sweepSlaBreaches, escalateBreachesFor, startSlaSweeper, stopSlaSweeper } from './sla-sweep';
export type { SweepResult } from './sla-sweep';
export { escalationFor, audienceFor, ESCALATION_STEPS } from './escalation-policy';
export type { EscalationDecision, EscalationLevel } from './escalation-policy';
