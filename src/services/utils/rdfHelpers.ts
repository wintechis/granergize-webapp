import { Parser, Store } from "n3";
import type { Term } from "n3";

/** Parse Turtle text into an n3 Store */
export function parseRdfText(text: string, baseIRI: string): Store {
  const parser = new Parser({ format: "text/turtle", baseIRI });
  return new Store(parser.parse(text));
}

/** Returns the first matching quad's object value, or undefined */
export function getQuadValue(
  store: Store,
  subject: Term | null,
  predicate: Term | null,
): string | undefined {
  return store.getQuads(subject, predicate, null, null)[0]?.object.value;
}

/** Returns all matching quads' object values */
export function getQuadValues(
  store: Store,
  subject: Term | null,
  predicate: Term | null,
): string[] {
  return store.getQuads(subject, predicate, null, null).map((q) =>
    q.object.value
  );
}
