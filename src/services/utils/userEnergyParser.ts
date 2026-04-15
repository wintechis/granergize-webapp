import { DataFactory, Parser, Store } from "n3";

const USERVOC_NS = "https://solid.ti.rw.fau.de/private/granergize/user-vocab.ttl#";
const SOSA_NS    = "http://www.w3.org/ns/sosa/";
const TIME_NS    = "http://www.w3.org/2006/time#";
const RDF_TYPE   = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const { namedNode } = DataFactory;

/**
 * Fetch and parse a user-role daily Turtle file.
 * Returns sorted array of {begin: ISO timestamp, value: kWh} readings.
 */
export async function parseTtlReadings(
  url: string,
  fetchFn: (url: string) => Promise<Response>,
): Promise<Array<{ begin: string; value: number }>> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = await response.text();
  const parser = new Parser({ baseIRI: url });
  const store = new Store(parser.parse(text));

  const readingQuads = store.getQuads(
    null, namedNode(RDF_TYPE), namedNode(`${USERVOC_NS}EnergyConsumptionReading`), null,
  );

  const parsed: Array<{ begin: string; value: number }> = [];
  readingQuads.forEach((obs) => {
    const resultQs = store.getQuads(obs.subject, namedNode(`${SOSA_NS}hasResult`), null, null);
    const valueQs  = resultQs.length ? store.getQuads(resultQs[0].object, namedNode(`${SOSA_NS}hasSimpleResult`), null, null) : [];
    const timeQs   = store.getQuads(obs.subject, namedNode(`${SOSA_NS}phenomenonTime`), null, null);
    const beginQs  = timeQs.length ? store.getQuads(timeQs[0].object, namedNode(`${TIME_NS}hasBeginning`), null, null) : [];
    if (!valueQs.length || !beginQs.length) return;
    parsed.push({ begin: beginQs[0].object.value, value: parseFloat(valueQs[0].object.value) });
  });

  parsed.sort((a, b) => a.begin.localeCompare(b.begin));
  return parsed;
}
