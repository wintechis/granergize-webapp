/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseTtlReadings } from "./userEnergyParser.ts";
import { SOSA_NS, TIME_NS, CONSUMPTION_NS } from "./vocabularies.ts";

const URL_ = "https://pod.example/granergize/buildings/b1/energy/2024-PT15M/2024-03-01.ttl";

// `a` (rdf:type) is built into Turtle, so no rdf: prefix is needed.
const PREFIXES = `@prefix sosa: <${SOSA_NS}> .
@prefix time: <${TIME_NS}> .
@prefix uv: <${CONSUMPTION_NS}> .
`;

/** One `uservoc:EnergyConsumptionReading` with a begin time and a simple result. */
function reading(id: string, begin: string, value: string): string {
  return `<#${id}> a uv:EnergyConsumptionReading ;
  sosa:phenomenonTime [ time:hasBeginning "${begin}" ] ;
  sosa:hasResult [ sosa:hasSimpleResult "${value}" ] .
`;
}

/** A fetchFn serving one Turtle body at URL_, 404 elsewhere. */
function serve(body: string, status = 200) {
  return (url: string) =>
    Promise.resolve(
      url.split("?")[0] === URL_
        ? new Response(body, { status, headers: { "Content-Type": "text/turtle" } })
        : new Response("Not found", { status: 404 }),
    );
}

Deno.test("parseTtlReadings returns readings sorted ascending by begin", async () => {
  const ttl = PREFIXES +
    reading("r2", "2024-03-01T00:15:00Z", "2.5") +
    reading("r1", "2024-03-01T00:00:00Z", "1") +
    reading("r3", "2024-03-01T00:30:00Z", "3.75");

  const out = await parseTtlReadings(URL_, serve(ttl));
  assert.deepEqual(out, [
    { begin: "2024-03-01T00:00:00Z", value: 1 },
    { begin: "2024-03-01T00:15:00Z", value: 2.5 },
    { begin: "2024-03-01T00:30:00Z", value: 3.75 },
  ]);
});

Deno.test("parseTtlReadings skips readings missing a value or a begin time", async () => {
  const ttl = PREFIXES +
    reading("ok", "2024-03-01T00:00:00Z", "5") +
    // missing hasResult/hasSimpleResult
    `<#noValue> a uv:EnergyConsumptionReading ;
       sosa:phenomenonTime [ time:hasBeginning "2024-03-01T00:15:00Z" ] .\n` +
    // missing phenomenonTime/hasBeginning
    `<#noTime> a uv:EnergyConsumptionReading ;
       sosa:hasResult [ sosa:hasSimpleResult "9" ] .\n`;

  const out = await parseTtlReadings(URL_, serve(ttl));
  assert.deepEqual(out, [{ begin: "2024-03-01T00:00:00Z", value: 5 }]);
});

Deno.test("parseTtlReadings returns [] for a document with no readings", async () => {
  const out = await parseTtlReadings(URL_, serve(PREFIXES));
  assert.deepEqual(out, []);
});

Deno.test("parseTtlReadings throws on a non-ok response", async () => {
  await assert.rejects(
    () => parseTtlReadings(URL_, serve("nope", 403)),
    /HTTP 403/,
  );
});
