import { DataFactory, type Store } from "n3";
import { CONSUMPTION_NS, GRAN_HAS_ENERGY_CERTIFICATE } from "../rdf/vocabularies.ts";
import {
  observationsRootForObservation,
  parseDatasetLink,
  seriesContainerUri,
} from "../rdf/energyDataset.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { filesContainerFor } from "../attachmentManager.ts";

/** One resource a building grant covers. */
export interface GrantTarget {
  uri: string;
  /** Granted with `acl:default` (a container whose members inherit). */
  isContainer: boolean;
}

export interface BuildingTargetOptions {
  /** Include the building's `cons:EnergyDataset` resources (default true). */
  includeEnergyData?: boolean;
  /** Restrict energy datasets to these years; omit for all years. */
  years?: number[];
  /**
   * Include the building file itself (default true). The grant side wants it;
   * the revoke side withdraws the building file separately, so it passes false.
   */
  includeBuildingFile?: boolean;
  /**
   * Restrict the attachment grant to these specific file IRIs; omit (or empty)
   * for all attachments. When given, EACH listed file is granted individually
   * (non-container) and the `files/` container default is NOT granted, so the
   * unselected binaries stay unreadable. Mirrors {@link years}.
   */
  attachmentUris?: string[];
}

/**
 * The energy-dataset targets declared by a building's `cons:hasEnergyDataset`
 * links in an already-parsed store: each (time-first) dataset descriptor file,
 * plus — for a series — its locating year container (`acl:default`, holding the
 * scattered day-chunks). Year-filtered when `years` is given.
 */
export function energyTargetsFromStore(
  store: Store,
  years?: number[],
): GrantTarget[] {
  const targets: GrantTarget[] = [];
  for (
    const link of store.getObjects(
      null,
      DataFactory.namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
      null,
    )
  ) {
    const ref = parseDatasetLink(link.value, store);
    if (!ref) continue;
    if (years && !years.includes(ref.year)) continue;
    const file = link.value.split("#")[0];
    targets.push({ uri: file, isContainer: false });
    if (isSeriesGranularity(ref.granularity)) {
      const root = observationsRootForObservation(link.value);
      targets.push({ uri: seriesContainerUri(root, ref.year), isContainer: true });
    }
  }
  return targets;
}

/**
 * The single source of truth for "what a building grant covers", computed from an
 * already-parsed building store: the building file (optional), its `files/`
 * container (`acl:default`), a legacy energy certificate stored outside `files/`,
 * and — when energy is included — every `cons:EnergyDataset` (year-filtered) plus
 * a series' daily-files container. Deduped by URL.
 *
 * The grant side ({@link buildingGrantTargets}) and the revoke side
 * ({@link getSubresourceAclTargets}) both derive from this one function, so the
 * applied ACL projection, the revoke withdrawal, and the audit diff cannot drift
 * apart. Pure — the caller does the I/O (one building fetch) and passes the store.
 */
export function buildingTargetsFromStore(
  store: Store,
  buildingFile: string,
  options: BuildingTargetOptions = {},
): GrantTarget[] {
  const {
    includeEnergyData = true,
    years,
    includeBuildingFile = true,
    attachmentUris,
  } = options;
  const filesContainer = filesContainerFor(buildingFile);
  const targets: GrantTarget[] = [];
  if (includeBuildingFile) targets.push({ uri: buildingFile, isContainer: false });

  // Attachments: no selection ⇒ grant the files/ container with acl:default,
  // covering every current AND future upload (the intensional "all"). A subset
  // grants each chosen file individually and WITHHOLDS the container default, so
  // the unselected binaries stay unreadable. NB: the building .ttl still lists
  // every attachment IRI (bldg:hasAttachment), so a recipient sees the metadata
  // of a withheld file but its binary returns 403 — the accepted tradeoff.
  if (attachmentUris && attachmentUris.length) {
    for (const uri of attachmentUris) targets.push({ uri, isContainer: false });
  } else {
    targets.push({ uri: filesContainer, isContainer: true });
  }

  // A legacy energy certificate stored OUTSIDE files/ (the old certificates/
  // folder) isn't covered by the container grant, so the file itself is a target.
  const cert = store.getObjects(
    null,
    DataFactory.namedNode(GRAN_HAS_ENERGY_CERTIFICATE),
    null,
  )[0];
  if (cert && !cert.value.startsWith(filesContainer)) {
    targets.push({ uri: cert.value, isContainer: false });
  }

  if (includeEnergyData) targets.push(...energyTargetsFromStore(store, years));

  // Dedup: two dataset links into the same file must not yield one target twice
  // (a doubled grant would race one read-modify-write against itself).
  const seen = new Set<string>();
  return targets.filter((t) => !seen.has(t.uri) && !!seen.add(t.uri));
}
