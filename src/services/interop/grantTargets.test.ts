/// <reference lib="deno.ns" />
import assert from "node:assert";
import { Parser, Store } from "n3";
import {
  buildingTargetsFromStore,
  energyTargetsFromStore,
} from "./grantTargets.ts";
import { CONSUMPTION_NS, GRAN_HAS_ENERGY_CERTIFICATE } from "../rdf/vocabularies.ts";

const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const ENERGY = `${BUILDING.replace(/\.ttl$/, "")}/energy`;
const FILES = `${BUILDING.replace(/\.ttl$/, "")}/files/`;
const LEGACY_CERT = "https://a.example/granergize/certificates/b-1-cert.pdf";

/** Building linking four datasets across two years/scenarios + a legacy cert. */
const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${ENERGY}/2024-P1Y.ttl#ds> ,
                        <${ENERGY}/2024-PT15M.ttl#ds> ,
                        <${ENERGY}/2024-P1Y-planned.ttl#ds> ,
                        <${ENERGY}/2023-P1Y.ttl#ds> ;
  <${GRAN_HAS_ENERGY_CERTIFICATE}> <${LEGACY_CERT}> .
`;

const store = () => new Store(new Parser({ baseIRI: BUILDING }).parse(BUILDING_TTL));

Deno.test("energyTargetsFromStore: every dataset + the series container, no filter", () => {
  const set = new Set(energyTargetsFromStore(store()).map((t) => t.url));
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-P1Y-planned.ttl`));
  assert.ok(set.has(`${ENERGY}/2023-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M/`), "series daily-files container");
  assert.strictEqual(set.size, 5);
});

Deno.test("energyTargetsFromStore: years:[2024] drops 2023, keeps the 2024 series container", () => {
  const set = new Set(energyTargetsFromStore(store(), [2024]).map((t) => t.url));
  assert.ok(!set.has(`${ENERGY}/2023-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M/`));
  assert.strictEqual(set.size, 4);
});

Deno.test("buildingTargetsFromStore: full grant set = file + files/ + legacy cert + energy", () => {
  const set = new Set(buildingTargetsFromStore(store(), BUILDING).map((t) => t.url));
  assert.ok(set.has(BUILDING), "building file");
  assert.ok(set.has(FILES), "files/ container");
  assert.ok(set.has(LEGACY_CERT), "legacy certificate outside files/");
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`), "energy datasets included");
  // files/ is a container (acl:default); the building file is not.
  const targets = buildingTargetsFromStore(store(), BUILDING);
  assert.strictEqual(targets.find((t) => t.url === FILES)!.isContainer, true);
  assert.strictEqual(targets.find((t) => t.url === BUILDING)!.isContainer, false);
});

Deno.test("buildingTargetsFromStore: a cert already inside files/ is NOT a separate target", () => {
  const certInFiles = `${FILES}cert.pdf`;
  const ttl = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1> <${GRAN_HAS_ENERGY_CERTIFICATE}> <${certInFiles}> .`;
  const s = new Store(new Parser({ baseIRI: BUILDING }).parse(ttl));
  const set = new Set(buildingTargetsFromStore(s, BUILDING).map((t) => t.url));
  assert.ok(!set.has(certInFiles), "inherited via the files/ container grant");
});

Deno.test("grant vs revoke enumerate the SAME set (the unification invariant)", () => {
  // The revoke side withdraws the same resources the grant side applies, minus
  // the building file (revoke withdraws that separately) — so the two views can
  // never drift apart, which is the whole point of one shared enumerator.
  const grant = buildingTargetsFromStore(store(), BUILDING, {
    includeBuildingFile: true,
  }).map((t) => t.url).sort();
  const revoke = buildingTargetsFromStore(store(), BUILDING, {
    includeBuildingFile: false,
  }).map((t) => t.url).sort();
  assert.deepStrictEqual(
    grant.filter((u) => u !== BUILDING),
    revoke,
    "revoke set === grant set minus the building file",
  );
});

Deno.test("buildingTargetsFromStore: includeEnergyData:false keeps only file + files/", () => {
  const set = new Set(
    buildingTargetsFromStore(store(), BUILDING, { includeEnergyData: false })
      .map((t) => t.url),
  );
  assert.ok(set.has(BUILDING));
  assert.ok(set.has(FILES));
  // The legacy cert stays (it isn't energy data); no datasets.
  assert.ok(!set.has(`${ENERGY}/2024-P1Y.ttl`));
});
