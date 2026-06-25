import { useLocation } from "react-router-dom";
import { isDetailRoute, type NavState, pushTrail } from "../routes.ts";

/** The current navigation trail, read from history state (react-router `location.state`). */
export function useNavTrail(): string[] {
  const loc = useLocation();
  return (loc.state as NavState | null)?.trail ?? [];
}

/**
 * Returns a builder for the react-router `state` to attach when navigating to a
 * `route`, so the destination — if a detail page — can offer a back affordance to
 * HERE, carried in history state (not the URL). Returns `undefined` for a non-detail
 * target (finders have no back affordance to feed). Used by {@link RefLink} for
 * `to`-links and at imperative `navigate()` sites (map markers, the rooms create
 * flow, the observations matrix).
 */
export function useTrailState(): (route: string) => NavState | undefined {
  const loc = useLocation();
  const current = `${loc.pathname}${loc.search}`;
  const trail = (loc.state as NavState | null)?.trail ?? [];
  return (route) =>
    isDetailRoute(route)
      ? { trail: pushTrail(trail, current, route) }
      : undefined;
}
