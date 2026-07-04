// GENERATED from the live linked-dwd /routes manifest — DO NOT EDIT BY HAND.
// Regenerate: deno task gen:routes:dwd  ·  Verify in CI: deno task gen:routes:dwd:check
// The union is the wrapper's DEPLOYED endpoint set; a renamed/removed route breaks the app's
// compile at the use site.
export type DwdRoute =
  | "bbox"
  | "near"
  | "observation"
  | "routes"
  | "station"
  | "values";
