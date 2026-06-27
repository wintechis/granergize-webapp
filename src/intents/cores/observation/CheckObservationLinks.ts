// Intent core (React-free) for CheckObservationLinks — an imperative READ-intent.
// See ./README.md: a read core returns its VALUE (here the drift report), never an
// outcome. The diffing twin of auditGrantsCore, for observation↔building links.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import {
  auditObservationLinks,
  type ObservationLinkAuditResult,
} from "../../../services/TurtleParsingService.ts";

/** The read's value type, re-exported with the core (the single headless entry point). */
export type { ObservationLinkAuditResult };

/**
 * React-free core of {@link import("../hooks/mutations.ts").useCheckObservationLinks}:
 * dry-run diff of each observation's `cons:ofBuilding` against the building's
 * `cons:hasEnergyDataset` link, returning the drift report. No writes — a pure read
 * whose whole point is the returned value. Takes `gateway` (no `getSession()`), so it
 * is callable headless.
 */
export function checkObservationLinksCore(
  gateway: PodGateway,
): Promise<ObservationLinkAuditResult> {
  return auditObservationLinks(gateway);
}
