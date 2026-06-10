import { DataFactory } from "n3";
import { RDF_TYPE, SOSA_NS, TIME_NS, CONSUMPTION_NS } from "./vocabularies.ts";
import { parseRdfText } from "./rdfHelpers.ts";

const { namedNode } = DataFactory;

/**
 * Fetch and parse a user-role daily Turtle file.
 * Returns sorted array of {begin: ISO timestamp, value: kWh} readings.
 * @operation query
 */
export async function parseTtlReadings(
  url: string,
  fetchFn: (url: string) => Promise<Response>,
): Promise<Array<{ begin: string; value: number }>> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const text = await response.text();
  const store = parseRdfText(text, url);

  const readingQuads = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(`${CONSUMPTION_NS}EnergyConsumptionReading`),
    null,
  );

  const parsed: Array<{ begin: string; value: number }> = [];
  readingQuads.forEach((obs) => {
    const resultQs = store.getQuads(
      obs.subject,
      namedNode(`${SOSA_NS}hasResult`),
      null,
      null,
    );
    const valueQs = resultQs.length
      ? store.getQuads(
        resultQs[0].object,
        namedNode(`${SOSA_NS}hasSimpleResult`),
        null,
        null,
      )
      : [];
    const timeQs = store.getQuads(
      obs.subject,
      namedNode(`${SOSA_NS}phenomenonTime`),
      null,
      null,
    );
    const beginQs = timeQs.length
      ? store.getQuads(
        timeQs[0].object,
        namedNode(`${TIME_NS}hasBeginning`),
        null,
        null,
      )
      : [];
    if (!valueQs.length || !beginQs.length) return;
    parsed.push({
      begin: beginQs[0].object.value,
      value: parseFloat(valueQs[0].object.value),
    });
  });

  parsed.sort((a, b) => a.begin.localeCompare(b.begin));
  return parsed;
}
