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
