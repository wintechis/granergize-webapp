import type { Quad } from "@rdfjs/types";

/**
 * The dataset registry — the RDF twin of the IRI-keyed query cache. Holds, per
 * **named graph = document IRI**, the quads the per-resource parses produced (plus
 * when they were recorded), replaced wholesale on refetch. Together the graphs form
 * the RDF dataset of what the app currently knows about the outside world; the
 * typed object model is a projection of it, and this registry keeps the source
 * side addressable so the provenance inspector can answer "where does this info
 * come from" per subject. Pure module-level store (no React, no I/O), in the same
 * shape as `lib/networkActivity.ts`. See `plans/plan-per-value-provenance.md`.
 */

interface GraphEntry {
  quads: readonly Quad[];
  /** ISO timestamp of when this graph was (re)recorded — parse time ≈ fetch time. */
  retrievedAt: string;
}

const graphs = new Map<string, GraphEntry>();

/**
 * Record one document's parse result under its graph IRI, replacing any previous
 * recording (refetch = replace, mirroring the query cache entry it twins).
 */
export function recordGraph(graphIri: string, quads: readonly Quad[]): void {
  graphs.set(graphIri, { quads, retrievedAt: new Date().toISOString() });
}

/** The recorded quads of one graph, or `null` when the document was never parsed. */
export function getGraphQuads(graphIri: string): readonly Quad[] | null {
  return graphs.get(graphIri)?.quads ?? null;
}

/** When the graph was last recorded (ISO), or `null` when never parsed. */
export function graphRetrievedAt(graphIri: string): string | null {
  return graphs.get(graphIri)?.retrievedAt ?? null;
}

/** All recorded graph IRIs (the dataset's graph names). */
export function listGraphIris(): string[] {
  return [...graphs.keys()];
}

/**
 * The graphs that mention a subject IRI — as a quad's subject or object. This is
 * the inspector's entry lookup: which documents say something about (or point at)
 * this entity.
 */
export function graphsMentioning(subjectIri: string): string[] {
  const out: string[] = [];
  for (const [iri, entry] of graphs) {
    const mentions = entry.quads.some(
      (q) => q.subject.value === subjectIri || q.object.value === subjectIri,
    );
    if (mentions) out.push(iri);
  }
  return out;
}

/**
 * The statements about a subject — its quads plus the blank-node closure (a
 * statement whose object is a blank node, e.g. a `prov:qualifiedAttribution`
 * node, is only readable with that node's own quads). Scoped to one graph when
 * given, else across the whole dataset.
 */
export function quadsAbout(subjectIri: string, graphIri?: string): Quad[] {
  const scope = graphIri
    ? ([graphs.get(graphIri)].filter(Boolean) as GraphEntry[])
    : [...graphs.values()];
  const out: Quad[] = [];
  for (const entry of scope) {
    const seen = new Set<string>([subjectIri]);
    const queue = [subjectIri];
    while (queue.length > 0) {
      const subject = queue.shift()!;
      for (const q of entry.quads) {
        if (q.subject.value !== subject) continue;
        out.push(q);
        if (q.object.termType === "BlankNode" && !seen.has(q.object.value)) {
          seen.add(q.object.value);
          queue.push(q.object.value);
        }
      }
    }
  }
  return out;
}

/** Drop every recorded graph (logout / tests). */
export function clearDatasetRegistry(): void {
  graphs.clear();
}
