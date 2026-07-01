// GENERATED from the live linked-osm /routes manifest — DO NOT EDIT BY HAND.
// Regenerate: deno task gen:routes:osm  ·  Verify in CI: deno task gen:routes:osm:check
// The union is the wrapper's DEPLOYED endpoint set; a renamed/removed route breaks the app's
// compile at the use site.
export type OsmRoute =
  | "changeset"
  | "error"
  | "geo/osm"
  | "geo/overpass"
  | "nominatim/search"
  | "osm/node"
  | "osm/relation"
  | "osm/way"
  | "overpass/around"
  | "overpass/features"
  | "overpass/node"
  | "overpass/poi"
  | "overpass/relation"
  | "overpass/way"
  | "routes"
  | "sparql"
  | "tag";
