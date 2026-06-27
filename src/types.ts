// Barrel for the object model — the entity/data types live in `src/types/<family>.ts`
// (split by family; see plans/plan-object-model-inventory.md). Importers reach every
// type via `from "…/types.ts"` unchanged; the generated `*Fields` and `genVocabInterface`
// also import the enums (Scenario / AggregationKind / …) through this barrel.
export * from "./types/building.ts";
export * from "./types/consumption.ts";
export * from "./types/aggregation.ts";
export * from "./types/agent.ts";
export * from "./types/core.ts";
