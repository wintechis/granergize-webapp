import type { Quad } from "@rdfjs/types";
import {
  getGraphQuads,
  graphRetrievedAt,
  graphsMentioning,
  quadsAbout,
} from "./datasetRegistry.ts";
import {
  getRequestLog,
  type RequestLogEntry,
} from "../../lib/networkActivity.ts";
import { type DataSource, SOURCES } from "../../constants/dataSources.ts";
import { PROV_NS } from "./vocabularies.ts";

/**
 * The provenance record — what the inspect-provenance popover renders for one
 * subject (or group of infos sharing a subject): which documents say something
 * about it (named by source tier), when the app fetched them, the PROV
 * statements about it, and the raw statements as the floor. Assembled purely
 * from the dataset registry + the request log; no I/O, no React.
 * See `plans/plan-per-value-provenance.md`.
 */

export type SourceTier = "mine" | "shared" | "open";

export interface ProvenanceSource {
  /** The document IRI = the registry graph name. */
  graphIri: string;
  /** Concentric ring, derived from where the document lives (heuristic:
   * under the viewer's storage root → `mine`; under a known open-source
   * wrapper base → `open`; anywhere else → `shared`/foreign). */
  tier: SourceTier;
  /** The open-source registry entry when the graph lives under a known base
   * (name + licence for the record's "where from" line). */
  source?: DataSource;
  /** When the graph was last parsed into the registry (ISO), if known. */
  retrievedAt: string | null;
  /** The most recent finished request for this document, when the request
   * log still holds it — status / duration / endedAt ("when" line). */
  lastRequest: RequestLogEntry | null;
}

export interface ProvenanceRecord {
  /** The group's subject IRIs (one for a single info; several for a group of
   * rows; empty for a document-level group — see {@link provenanceRecordFor}). */
  subjectIris: string[];
  sources: ProvenanceSource[];
  /** "Who says so" — the PROV statements about the subjects (incl. the
   * attribution blank node's detail via the registry's bnode closure). */
  provStatements: Quad[];
  /** The raw floor — every statement about the subjects across their graphs. */
  statements: Quad[];
}

/** The concentric ring a document IRI falls in, per the heuristic above. */
export function tierOfGraph(
  graphIri: string,
  storageRoot?: string,
): SourceTier {
  if (storageRoot && graphIri.startsWith(storageRoot)) return "mine";
  if (openSourceForGraph(graphIri)) return "open";
  return "shared";
}

/** The `SOURCES` entry whose base IRI prefixes this document IRI, if any. */
export function openSourceForGraph(graphIri: string): DataSource | undefined {
  // SOURCES is a literal-typed const map; widen to the interface to read `base`.
  const all = Object.values(SOURCES) as DataSource[];
  return all.find((s) => !!s.base && graphIri.startsWith(s.base));
}

/** The newest finished request for this URL still in the rolling log. */
export function lastRequestFor(url: string): RequestLogEntry | null {
  return getRequestLog().find((e) => e.url === url) ?? null; // log is newest-first
}

/**
 * Assemble the record for a group's subject(s). `sources` pins the document
 * set when the caller knows it (a group annotation, a composite's
 * `{activity, sources}`); otherwise every registry graph mentioning a subject
 * is used. An EMPTY subject list with pinned sources is the document-level
 * group ("this card renders these documents"): the statements are then the
 * pinned graphs' full contents.
 */
export function provenanceRecordFor(
  subjects: string | readonly string[],
  opts: { storageRoot?: string; sources?: readonly string[] } = {},
): ProvenanceRecord {
  const subjectIris = typeof subjects === "string" ? [subjects] : [...subjects];
  const graphIris = opts.sources?.length
    ? [...opts.sources]
    : [...new Set(subjectIris.flatMap((s) => graphsMentioning(s)))];
  const sources = graphIris.map((graphIri): ProvenanceSource => ({
    graphIri,
    tier: tierOfGraph(graphIri, opts.storageRoot),
    source: openSourceForGraph(graphIri),
    retrievedAt: graphRetrievedAt(graphIri),
    lastRequest: lastRequestFor(graphIri),
  }));
  const statements = subjectIris.length > 0
    ? subjectIris.flatMap((s) => quadsAbout(s))
    : graphIris.flatMap((g) => [...(getGraphQuads(g) ?? [])]);
  const provStatements = statements.filter((q) =>
    q.predicate.value.startsWith(PROV_NS)
  );
  return { subjectIris, sources, provStatements, statements };
}
