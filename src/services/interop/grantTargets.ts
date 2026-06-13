import { DataFactory, type Store } from "n3";
import { CONSUMPTION_NS, GRAN_HAS_ENERGY_CERTIFICATE } from "../rdf/vocabularies.ts";
import { parseDatasetSlug } from "../rdf/energyDataset.ts";
import { isSeriesGranularity } from "../rdf/durationUtils.ts";
import { filesContainerFor } from "../attachmentManager.ts";

/** One resource a building grant covers. */
export interface GrantTarget {
  url: string;
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
}

/**
 * The energy-dataset targets declared by a building's `cons:hasEnergyDataset`
 * links in an already-parsed store: each dataset file, plus a series' daily-files
 * container (`acl:default`). Year-filtered when `years` is given.
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
    const ref = parseDatasetSlug(link.value);
    if (!ref) continue;
    if (years && !years.includes(ref.year)) continue;
    const file = link.value.split("#")[0];
    targets.push({ url: file, isContainer: false });
    if (isSeriesGranularity(ref.granularity)) {
      targets.push({ url: file.replace(/\.ttl$/, "/"), isContainer: true });
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
  } = options;
  const filesContainer = filesContainerFor(buildingFile);
  const targets: GrantTarget[] = [];
  if (includeBuildingFile) targets.push({ url: buildingFile, isContainer: false });
  targets.push({ url: filesContainer, isContainer: true });

  // A legacy energy certificate stored OUTSIDE files/ (the old certificates/
  // folder) isn't covered by the container grant, so the file itself is a target.
  const cert = store.getObjects(
    null,
    DataFactory.namedNode(GRAN_HAS_ENERGY_CERTIFICATE),
    null,
  )[0];
  if (cert && !cert.value.startsWith(filesContainer)) {
    targets.push({ url: cert.value, isContainer: false });
  }

  if (includeEnergyData) targets.push(...energyTargetsFromStore(store, years));

  // Dedup: two dataset links into the same file must not yield one target twice
  // (a doubled grant would race one read-modify-write against itself).
  const seen = new Set<string>();
  return targets.filter((t) => !seen.has(t.url) && !!seen.add(t.url));
}
