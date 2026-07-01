/// <reference lib="deno.ns" />
// The cross-layer cache-sharing contract: the service-side accessors
// (buildingSource.ts / sharingLog.ts peeks, the ensureQueryData key builders)
// must read/write the SAME entries the hooks register under the `queryKeys`
// registry. Before the keys were unified in this leaf module, the services
// re-hardcoded the literals — a key rename in the registry silently degraded
// every service-side peek to `null` (a fresh refetch, or a hidden-buildings
// fallback) with no test failing. This suite pins the contract by seeding a
// published QueryClient under the REGISTRY keys and asserting the service
// accessors see the data.
import { strict as assert } from "node:assert";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys.ts";
import { _setAppQueryClient } from "./appQueryClient.ts";
import {
  buildingSourceKey,
  cachedBuilding,
  cachedHiddenBuildings,
} from "../services/building/buildingSource.ts";
import { energyDatasetKey } from "../services/energy/energyDatasetCache.ts";
import {
  cachedSharingGrants,
  type SharingEvent,
} from "../services/interop/sharingLog.ts";
import type { Building } from "../types.ts";

const WEBID = "https://pod.example/profile/card#me";
const SOURCE = "https://pod.example/granergize/buildings/b1.ttl";
const B1 = `${SOURCE}#b1`;
const EVENT = "https://pod.example/granergize/shared-in/e1";

function withClient(run: (qc: QueryClient) => void): void {
  const qc = new QueryClient();
  _setAppQueryClient(qc);
  try {
    run(qc);
  } finally {
    _setAppQueryClient(null);
  }
}

Deno.test("the ensureQueryData key builders derive from the registry prefixes", () => {
  assert.deepEqual(
    buildingSourceKey(WEBID, SOURCE),
    [...queryKeys.buildingSource, WEBID, SOURCE],
    "buildingSource keys shared between useBuildings and fetchBuildingSourceShared",
  );
  assert.deepEqual(
    energyDatasetKey(WEBID, "ds1"),
    [...queryKeys.energyDataset, WEBID, "ds1"],
    "energyDataset keys shared between the hooks and the aggregation compute",
  );
});

Deno.test("cachedHiddenBuildings reads the prefs entry the usePrefs hook caches", () => {
  withClient((qc) => {
    const hidden = new Set([SOURCE]);
    qc.setQueryData([...queryKeys.prefs, WEBID], { hiddenBuildings: hidden });
    assert.equal(
      cachedHiddenBuildings(WEBID),
      hidden,
      "the service peek reads the hook-keyed prefs cache",
    );
  });
});

Deno.test("cachedBuilding reads the per-source entries the useBuildings fan-out caches", () => {
  withClient((qc) => {
    const building = { uri: B1 } as Building;
    qc.setQueryData([...queryKeys.buildingSource, WEBID, SOURCE], [building]);
    assert.equal(
      cachedBuilding(B1),
      building,
      "the read-core peek finds the hook-cached building",
    );
  });
});

Deno.test("cachedSharingGrants folds the listing + event entries the sharing-log queries cache", () => {
  withClient((qc) => {
    const grant: SharingEvent = {
      type: "grant",
      owner: "https://other.example/profile/card#me",
      grantee: WEBID,
      resource: SOURCE,
      kind: "Building",
      at: "2026-06-04T10:00:00Z",
    };
    qc.setQueryData([...queryKeys.sharedInContainer, WEBID], [EVENT]);
    qc.setQueryData([...queryKeys.sharingEvent, WEBID, EVENT], [grant]);
    const grants = cachedSharingGrants(WEBID, "sharedInContainer");
    assert.equal(grants?.length, 1, "the warm fold sees the hook-cached log");
    assert.equal(grants?.[0].resource, SOURCE);
  });
});
