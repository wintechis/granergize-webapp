// GENERATED from the live linked-wetterdienst /routes manifest — DO NOT EDIT BY HAND.
// Regenerate: deno task gen:routes:wetterdienst  ·  Verify in CI: deno task gen:routes:wetterdienst:check
// The union is the wrapper's DEPLOYED endpoint set; a renamed/removed route breaks the app's
// compile at the use site.
export type WetterdienstRoute =
  | "bbox"
  | "near"
  | "observation"
  | "routes"
  | "station"
  | "values";
