/// <reference lib="deno.ns" />
import assert from "node:assert";
import { Parser, Store } from "n3";
import {
  buildingTargetsFromStore,
  energyTargetsFromStore,
} from "./grantTargets.ts";
import { CONSUMPTION_NS, GRAN_HAS_ENERGY_CERTIFICATE } from "../rdf/vocabularies.ts";

const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const OBS = "https://a.example/granergize/observations";
const FILES = `${BUILDING.replace(/\.ttl$/, "")}/files/`;
const LEGACY_CERT = "https://a.example/granergize/certificates/b-1-cert.pdf";

// Time-first dataset descriptor IRIs (random ids stand in as fixed test stems).
const DS_2024_P1Y = `${OBS}/2024/a1.ttl`;
const DS_2024_PT15M = `${OBS}/2024/a2.ttl`;
const DS_2024_PLANNED = `${OBS}/2024/a3.ttl`;
const DS_2023_P1Y = `${OBS}/2023/a4.ttl`;
const YEAR_2024 = `${OBS}/2024/`;

/** Building linking four datasets across two years/scenarios + a legacy cert. */
const BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1>
  cons:hasEnergyDataset <${DS_2024_P1Y}#ds> ,
                        <${DS_2024_PT15M}#ds> ,
                        <${DS_2024_PLANNED}#ds> ,
                        <${DS_2023_P1Y}#ds> ;
  <${GRAN_HAS_ENERGY_CERTIFICATE}> <${LEGACY_CERT}> .
<${DS_2024_P1Y}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
<${DS_2024_PT15M}#ds> cons:granularity "PT15M" ; cons:scenario cons:Actual .
<${DS_2024_PLANNED}#ds> cons:granularity "P1Y" ; cons:scenario cons:Planned .
<${DS_2023_P1Y}#ds> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

const store = () => new Store(new Parser({ baseIRI: BUILDING }).parse(BUILDING_TTL));

Deno.test("energyTargetsFromStore: every dataset + the series' year container, no filter", () => {
  const set = new Set(energyTargetsFromStore(store()).map((t) => t.uri));
  assert.ok(set.has(DS_2024_P1Y));
  assert.ok(set.has(DS_2024_PT15M));
  assert.ok(set.has(DS_2024_PLANNED));
  assert.ok(set.has(DS_2023_P1Y));
  assert.ok(set.has(YEAR_2024), "series day-chunks' year container");
  assert.strictEqual(set.size, 5);
});

Deno.test("energyTargetsFromStore: years:[2024] drops 2023, keeps the 2024 series container", () => {
  const set = new Set(energyTargetsFromStore(store(), [2024]).map((t) => t.uri));
  assert.ok(!set.has(DS_2023_P1Y));
  assert.ok(set.has(YEAR_2024));
  assert.strictEqual(set.size, 4);
});

Deno.test("buildingTargetsFromStore: full grant set = file + files/ + legacy cert + energy", () => {
  const set = new Set(buildingTargetsFromStore(store(), BUILDING).map((t) => t.uri));
  assert.ok(set.has(BUILDING), "building file");
  assert.ok(set.has(FILES), "files/ container");
  assert.ok(set.has(LEGACY_CERT), "legacy certificate outside files/");
  assert.ok(set.has(DS_2024_P1Y), "energy datasets included");
  // files/ is a container (acl:default); the building file is not.
  const targets = buildingTargetsFromStore(store(), BUILDING);
  assert.strictEqual(targets.find((t) => t.uri === FILES)!.isContainer, true);
  assert.strictEqual(targets.find((t) => t.uri === BUILDING)!.isContainer, false);
});

Deno.test("buildingTargetsFromStore: a cert already inside files/ is NOT a separate target", () => {
  const certInFiles = `${FILES}cert.pdf`;
  const ttl = `
@prefix cons: <${CONSUMPTION_NS}> .
<${BUILDING}#b-1> <${GRAN_HAS_ENERGY_CERTIFICATE}> <${certInFiles}> .`;
  const s = new Store(new Parser({ baseIRI: BUILDING }).parse(ttl));
  const set = new Set(buildingTargetsFromStore(s, BUILDING).map((t) => t.uri));
  assert.ok(!set.has(certInFiles), "inherited via the files/ container grant");
});

Deno.test("grant vs revoke enumerate the SAME set (the unification invariant)", () => {
  // The revoke side withdraws the same resources the grant side applies, minus
  // the building file (revoke withdraws that separately) — so the two views can
  // never drift apart, which is the whole point of one shared enumerator.
  const grant = buildingTargetsFromStore(store(), BUILDING, {
    includeBuildingFile: true,
  }).map((t) => t.uri).sort();
  const revoke = buildingTargetsFromStore(store(), BUILDING, {
    includeBuildingFile: false,
  }).map((t) => t.uri).sort();
  assert.deepStrictEqual(
    grant.filter((u) => u !== BUILDING),
    revoke,
    "revoke set === grant set minus the building file",
  );
});

Deno.test("buildingTargetsFromStore: an attachment subset grants each file, NOT the files/ container", () => {
  const A1 = `${FILES}plan.pdf`;
  const A2 = `${FILES}lease.pdf`;
  const targets = buildingTargetsFromStore(store(), BUILDING, {
    includeEnergyData: false,
    attachmentUris: [A1, A2],
  });
  const set = new Set(targets.map((t) => t.uri));
  // Each selected attachment is an individual, non-container target.
  assert.ok(set.has(A1));
  assert.ok(set.has(A2));
  assert.strictEqual(targets.find((t) => t.uri === A1)!.isContainer, false);
  // The files/ container default is WITHHELD so unselected files stay private.
  assert.ok(!set.has(FILES), "files/ container is not granted for a subset");
});

Deno.test("buildingTargetsFromStore: absent attachmentUris grants the files/ container (intensional all)", () => {
  const set = new Set(
    buildingTargetsFromStore(store(), BUILDING, { includeEnergyData: false })
      .map((t) => t.uri),
  );
  assert.ok(set.has(FILES), "files/ container granted when no subset is given");
});

Deno.test("buildingTargetsFromStore: empty attachmentUris falls back to the files/ container", () => {
  const set = new Set(
    buildingTargetsFromStore(store(), BUILDING, {
      includeEnergyData: false,
      attachmentUris: [],
    }).map((t) => t.uri),
  );
  assert.ok(set.has(FILES), "an empty selection is treated as all");
});

Deno.test("buildingTargetsFromStore: includeEnergyData:false keeps only file + files/", () => {
  const set = new Set(
    buildingTargetsFromStore(store(), BUILDING, { includeEnergyData: false })
      .map((t) => t.uri),
  );
  assert.ok(set.has(BUILDING));
  assert.ok(set.has(FILES));
  // The legacy cert stays (it isn't energy data); no datasets.
  assert.ok(!set.has(DS_2024_P1Y));
});
