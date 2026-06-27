/**
 * `FindNearbyInstallations` — a federated **query** read (plan-open-tier-intents
 * §"New intents"): the public renewable generation units near a building, from the
 * `linked-mastr` wrapper (the `open` source tier). Resolves the building
 * (EntityQuery) for its coordinates, then queries the wrapper by a radius box; an
 * optional `kind` narrows the carrier client-side. Off-Pod, read-only — returns
 * `NearbyInstallation[]`, never Pod state. The wrapper fetch is injected so the core
 * is Tier-1-testable without the live service.
 */
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import type { BuildingType } from "../../../types.ts";
import { resolve } from "../../entityQuery.ts";
import {
  fetchNearbyInstallations,
  type InstallationKind,
  type NearbyInstallation,
  type NearbyOptions,
} from "../../../services/mastrNearby.ts";

export interface FindNearbyInstallationsParams {
  /** The building whose surroundings to scan — resolved to its coordinates. */
  building: string;
  /** Narrow to one carrier (absent ⇒ all carriers). */
  kind?: InstallationKind;
  /** Search-box half-width in km (absent ⇒ the wrapper default). */
  radiusKm?: number;
}

/** Injectable wrapper fetch (defaults to the real `linked-mastr` query). */
export type FetchNearby = (
  lat: number,
  long: number,
  opts: NearbyOptions,
) => Promise<NearbyInstallation[]>;

export async function findNearbyInstallationsCore(
  gateway: PodGateway,
  params: FindNearbyInstallationsParams,
  fetch: FetchNearby = fetchNearbyInstallations,
): Promise<NearbyInstallation[]> {
  const obj = await resolve("building", params.building, gateway);
  if (!obj || !("lat" in obj)) return [];
  const b = obj as BuildingType;
  if (b.lat == null || b.long == null) return [];
  const all = await fetch(b.lat, b.long, { radiusKm: params.radiusKm });
  return params.kind ? all.filter((i) => i.kind === params.kind) : all;
}
