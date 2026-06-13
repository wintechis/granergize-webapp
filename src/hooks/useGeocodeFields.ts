import { useState } from "react";
import { geocodeFields } from "../services/geocode.ts";
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
      const coords = await geocodeFields(fields);
      if (!coords) {
        showNotification("Address not found", "warning");
        return;
      }
      setField("lat", coords.lat);
      setField("long", coords.long);
      setField("geocodePrecision", coords.precision);
      showNotification(successMessage, "success");
    } finally {
      setBusy(false);
    }
  };

  return { onGeocode, busy };
}
