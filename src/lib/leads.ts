// Lead statuses: the portal's original pipeline plus the CRM statuses
// requested for Phase 2 (Qualified, Proposal, Invalid). Settings-driven
// statuses come with the Leads CRM phase.
import { LEGACY_STATUSES, SALES_STATUSES } from "./salesPipeline";

/** Sales statuses first (stored keys; labels via statusLabel), then the older ones still on existing leads. */
export const LEAD_STATUSES = [...SALES_STATUSES.map((s) => s.key), ...LEGACY_STATUSES];
