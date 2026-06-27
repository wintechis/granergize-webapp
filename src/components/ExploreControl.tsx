import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import { geocodeFields } from "../services/sources/geocode.ts";
import { useT } from "../context/I18nProvider.tsx";
import { useNotification } from "../context/NotificationContext.tsx";

/**
 * The open tier's **exploration** affordance (opt-in): a toggle that switches the open
 * layers from the concentric own-data anchor to the **map viewport** (`?explore=1`, read
 * by the open-fetch consumers), plus a place-search box that geocodes a name and recentres
 * the map there (`?c`/`?z`) so the viewport fetch loads open data for that place. Rendered
 * only when the `open` tier is ticked. The default stays concentric; this is the deliberate
 * deviation (notes/data-architecture.md §Reaching the outer ring).
 */
export default function ExploreControl() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showNotification } = useNotification();
  const exploreOn = searchParams.get("explore") === "1";
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const toggle = () =>
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (exploreOn) sp.delete("explore");
      else sp.set("explore", "1");
      return sp;
    });

  const search = async () => {
    const place = query.trim();
    if (!place) return;
    setSearching(true);
    try {
      const hit = await geocodeFields({ locality: place });
      if (!hit) {
        showNotification(t("exploreNoMatch", { place }), "warning");
        return;
      }
      setSearchParams((prev) => {
        const sp = new URLSearchParams(prev);
        sp.set("explore", "1");
        sp.set(
          "c",
          `${Number(hit.lat).toFixed(5)},${Number(hit.long).toFixed(5)}`,
        );
        sp.set("z", "12");
        return sp;
      });
    } finally {
      setSearching(false);
    }
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Button
        size="small"
        variant={exploreOn ? "contained" : "outlined"}
        startIcon={<TravelExploreIcon />}
        onClick={toggle}
        aria-pressed={exploreOn}
      >
        {t("exploreToggle")}
      </Button>
      {exploreOn && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          sx={{ display: "flex", gap: 1 }}
        >
          <TextField
            size="small"
            placeholder={t("explorePlacePlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button size="small" type="submit" disabled={searching || !query.trim()}>
            {t("exploreSearchBtn")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
