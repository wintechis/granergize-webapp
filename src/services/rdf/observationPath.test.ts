/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  observationContainer,
  observationUri,
  parseObservationUri,
} from "./observationPath.ts";

const ROOT = "https://alice.example/granergize/observations/";

Deno.test("observationUri builds time-first paths at each resolution", () => {
  assert.equal(observationUri(ROOT, { year: 2024, id: "ds1" }), `${ROOT}2024/ds1.ttl`);
  assert.equal(
    observationUri(ROOT, { year: 2024, month: 6, id: "ds1" }),
    `${ROOT}2024/06/ds1.ttl`,
  );
  assert.equal(
    observationUri(ROOT, { year: 2024, month: 6, day: 3, id: "ds1" }),
    `${ROOT}2024/06/03/ds1.ttl`,
  );
});

Deno.test("observationUri rejects day without month", () => {
  assert.throws(() => observationUri(ROOT, { year: 2024, day: 3, id: "x" }));
});

Deno.test("observationContainer is the period rollup target", () => {
  assert.equal(observationContainer(ROOT, {}), ROOT);
  assert.equal(observationContainer(ROOT, { year: 2024 }), `${ROOT}2024/`);
  assert.equal(
    observationContainer(ROOT, { year: 2024, month: 6 }),
    `${ROOT}2024/06/`,
  );
});

Deno.test("parseObservationUri inverts observationUri (and tolerates a fragment)", () => {
  for (
    const ref of [
      { year: 2024, id: "ds1" },
      { year: 2024, month: 6, id: "ds1" },
      { year: 2024, month: 6, day: 3, id: "ds1" },
    ]
  ) {
    assert.deepEqual(parseObservationUri(ROOT, observationUri(ROOT, ref)), ref);
  }
  // a #fragment on the leaf is stripped before parsing
  assert.deepEqual(parseObservationUri(ROOT, `${ROOT}2024/ds1.ttl#it`), {
    year: 2024,
    id: "ds1",
  });
});

Deno.test("parseObservationUri rejects foreign / malformed paths", () => {
  assert.equal(parseObservationUri(ROOT, "https://other.example/x/ds.ttl"), null);
  assert.equal(parseObservationUri(ROOT, `${ROOT}24/ds.ttl`), null); // year not 4 digits
  assert.equal(parseObservationUri(ROOT, `${ROOT}2024/`), null); // no leaf id
});
