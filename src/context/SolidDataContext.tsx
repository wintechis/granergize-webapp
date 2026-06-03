// The Solid data layer is now React Query (see src/hooks/queries.ts). This file
// remains only as a back-compat re-export so existing `useSolidData()` call sites
// keep working; there is no longer a context/provider. New code should import the
// granular hooks (useBuildingsAndAgents, useEnergy, …) from ../hooks/queries.ts.
export { type SolidData, useSolidData } from "../hooks/queries.ts";
