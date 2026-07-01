// GENERATED from the live linked-nuts /routes manifest — DO NOT EDIT BY HAND.
// Regenerate: deno task gen:routes:nuts  ·  Verify in CI: deno task gen:routes:nuts:check
// The union is the wrapper's DEPLOYED endpoint set; a renamed/removed route breaks the app's
// compile at the use site.
export type NutsRoute =
  | "cl"
  | "contains"
  | "geojson"
  | "nuts"
  | "routes"
  | "search"
  | "sparql";
