import { DataFactory, Store } from "n3";
import { GRAN_NS, RDF_TYPE } from "./vocabularies.ts";

const { namedNode } = DataFactory;

/**
 * Lightweight structural validators for the app's registry / view / sharing
 * files, mirroring the shapes in `roles.shex`. ShEx engines don't run under Deno
 * (see roles.shex / roleDetection.ts), so these n3-based checks are what the
 * offline tests actually run to guard the on-Pod data shapes against drift. They
 * check the load-bearing constraints (term kinds, required keys), not every
 * optional triple.
 */
export interface ShapeResult {
  valid: boolean;
  problems: string[];
}

function result(problems: string[]): ShapeResult {
  return { valid: problems.length === 0, problems };
}

/** Every object of `predicate` must be an IRI. */
function objectsMustBeIris(store: Store, predicate: string): string[] {
  const problems: string[] = [];
  for (const q of store.getQuads(null, namedNode(predicate), null, null)) {
    if (q.object.termType !== "NamedNode") {
      problems.push(`${predicate} object must be an IRI, got "${q.object.value}"`);
    }
  }
  return problems;
}

/** Every object of `predicate` must be a literal. */
function objectsMustBeLiterals(store: Store, predicate: string): string[] {
  const problems: string[] = [];
  for (const q of store.getQuads(null, namedNode(predicate), null, null)) {
    if (q.object.termType !== "Literal") {
      problems.push(`${predicate} object must be a literal, got <${q.object.value}>`);
    }
  }
  return problems;
}

/** `<DataSourcesRegistry>` — building/agent sources and role annotations are IRIs. */
export function validateDataSourcesRegistry(store: Store): ShapeResult {
  return result([
    ...objectsMustBeIris(store, `${GRAN_NS}hasBuildingDataSource`),
    ...objectsMustBeIris(store, `${GRAN_NS}hasAgentDataSource`),
    ...objectsMustBeIris(store, `${GRAN_NS}dataSourceRole`),
  ]);
}

/** `<HiddenBuildings>` — every hidden entry is a building IRI. */
export function validateHiddenBuildings(store: Store): ShapeResult {
  return result(objectsMustBeIris(store, `${GRAN_NS}hiddenBuilding`));
}

/** `<SharingRegistry>` — recipients are WebID IRIs. */
export function validateSharingRegistry(store: Store): ShapeResult {
  return result(objectsMustBeIris(store, `${GRAN_NS}sharedWith`));
}

/** `<ViewSharingRegistry>` — recipients are IRIs; viewId (if present) is a literal. */
export function validateViewSharingRegistry(store: Store): ShapeResult {
  return result([
    ...objectsMustBeIris(store, `${GRAN_NS}sharedWith`),
    ...objectsMustBeLiterals(store, `${GRAN_NS}viewId`),
  ]);
}

/** `<AggregatedViewDefinition>` — each typed node needs a viewId; building refs are IRIs. */
export function validateAggregatedViewDefinitions(store: Store): ShapeResult {
  const problems: string[] = [];
  const defs = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(`${GRAN_NS}AggregatedViewDefinition`),
    null,
  );
  for (const d of defs) {
    const subj = d.subject;
    const viewId = store.getQuads(subj, namedNode(`${GRAN_NS}viewId`), null, null);
    if (viewId.length === 0) {
      problems.push(`view <${subj.value}> is missing gran:viewId`);
    } else if (viewId[0].object.termType !== "Literal") {
      problems.push(`view <${subj.value}> gran:viewId must be a literal`);
    }
    for (
      const ib of store.getQuads(
        subj,
        namedNode(`${GRAN_NS}includesBuilding`),
        null,
        null,
      )
    ) {
      if (ib.object.termType !== "NamedNode") {
        problems.push(`view <${subj.value}> includesBuilding must be an IRI`);
      }
    }
  }
  return result(problems);
}

/** `<AggregatedViewSnapshot>` — computedAt (if present) is a literal timestamp. */
export function validateAggregatedViewSnapshot(store: Store): ShapeResult {
  return result(objectsMustBeLiterals(store, `${GRAN_NS}computedAt`));
}
