/**
 * The **interface the app requires** of an open-data wrapper, for the Data-sources view: the route
 * manifest, the routes the app calls (+ what each is for), and dereferenceable **example entities**
 * — both a plain domain entity and the wrapper's **LIDS** service-call entities (the `#id` inputs).
 * Static, per-source metadata (URLs built from the registry base + the app's own dependency on the
 * wrapper); the live example domain-entity IRI comes from the probe ({@link WrapperStatus.exampleEntity}).
 * Starting with **mastr**.
 */
import { sourceBase } from "../../constants/dataSources.ts";
import { MASTR_ROUTES } from "./mastrNearby.ts";

/** One route the app depends on, and what it uses it for. */
export interface RequiredRoute {
  route: string;
  purpose: string;
}

/** A named, dereferenceable example URL (a domain entity, or a LIDS service-call entity). */
export interface ExampleLink {
  label: string;
  url: string;
}

export interface WrapperContract {
  /** The live route manifest (option-C source of truth). */
  routesUrl: string;
  /** The routes the app calls on this wrapper, with their purpose. */
  requires: RequiredRoute[];
  /** LIDS service-call example entities — the `<call?params#id>` inputs the wrapper reifies. */
  lidsExamples: ExampleLink[];
}

/** Per-source contract descriptors. Extend as sources are added. */
const CONTRACTS: Record<string, () => WrapperContract> = {
  mastr: () => {
    const b = sourceBase("mastr");
    const box = "11.0,49.4,11.12,49.5";
    return {
      routesUrl: `${b}routes`,
      requires: [
        { route: MASTR_ROUTES.within, purpose: "nearby renewable installations in a bounding box" },
        { route: MASTR_ROUTES.filter, purpose: "installations by Gemeinde/Kreis AGS" },
      ],
      // Bounded with a small `count` so the example derefs are tiny (illustrate the LIDS call
      // entity, not dump a Gemeinde's ~60k units / all Bavaria's ~300k).
      lidsExamples: [
        { label: "within → BoundingBox", url: `${b}within?bbox=${box}&count=10#id` },
        { label: "filter → Query", url: `${b}filter?ags=09564000&count=10#id` },
      ],
    };
  },
};

export function hasWrapperContract(id: string): boolean {
  return id in CONTRACTS;
}

/** The interface contract the app requires of a source, or `null` if none is described. */
export function wrapperContract(id: string): WrapperContract | null {
  return CONTRACTS[id]?.() ?? null;
}
