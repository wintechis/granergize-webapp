import { msg } from "../lib/messages.ts";
import { useState } from "react";
import { geocodeWithRegion } from "../services/sources/geocode.ts";
import { useNotification } from "../context/NotificationContext.tsx";

/**
 * Geocode the address in `fields` into `lat`/`long`/`geocodePrecision` — the shared
 * behaviour behind the Add and Edit building dialogs' "Geocode" button (the only
 * difference was the success wording, hence `successMessage`). Returns the click
 * handler and its busy flag (a non-mutation read, so it owns its own `busy` rather
 * than a mutation's `isPending`).
 */
export function useGeocodeFields(
  fields: Record<string, string>,
  setField: (key: string, value: string) => void,
  successMessage: string,
): { onGeocode: () => Promise<void>; busy: boolean } {
  const { showNotification } = useNotification();
  const [busy, setBusy] = useState(false);

  const onGeocode = async () => {
    setBusy(true);
    try {
      const coords = await geocodeWithRegion(fields);
      if (!coords) {
        showNotification(msg("addressNotFound"), "warning");
        return;
      }
      setField("lat", coords.lat);
      setField("long", coords.long);
      setField("geocodePrecision", coords.precision);
      // The region resolved from the new coordinates (empty clears a stale one). Clear
      // any carried-over concept IRI too, so the serializer rebuilds dcterms:spatial
      // from this fresh AGS rather than reusing the old region.
      setField("regionAgs", coords.regionAgs ?? "");
      setField("regionConceptIri", "");
      showNotification(successMessage, "success");
    } finally {
      setBusy(false);
    }
  };

  return { onGeocode, busy };
}
