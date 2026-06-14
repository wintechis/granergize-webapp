import { useNavigate } from "react-router-dom";

/**
 * Back behaviour for the standalone detail routes (contact, energy, view):
 * return to the app's previous in-app location when there is one — the tab the
 * user actually came from (map, Connect, Share, …) — and fall back to the
 * overview only for a deep link / fresh tab with no in-app history.
 * react-router maintains `history.state.idx` (0 for the first same-document
 * entry), so a positive idx means there is somewhere in-app to go back to.
 */
export function useBackNavigation(): () => void {
  const navigate = useNavigate();
  return () => {
    const idx =
      (globalThis.history.state as { idx?: number } | null)?.idx ?? 0;
    // react-router v7's navigate returns a promise; navigation is fire-and-forget
    // here (nothing awaits it, and it doesn't meaningfully reject).
    if (idx > 0) void navigate(-1);
    else void navigate("/");
  };
}
