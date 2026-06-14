/**
 * Map a camera-startup failure (getUserMedia via html5-qrcode) to a sentence a
 * regular user can act on. The library rejects with DOMExceptions OR plain
 * strings that embed the DOMException name (e.g. "Error getting userMedia,
 * error = NotAllowedError: The request is not allowed…"), so matching is by
 * name-substring over both forms. The raw error stays in the console (the
 * caller logs it) — this is only the user-facing text.
 */
export function describeCameraError(err: unknown): string {
  const raw = err instanceof Error
    ? `${err.name}: ${err.message}`
    : String(err);
  if (raw.includes("NotAllowedError") || raw.includes("PermissionDenied")) {
    return "Camera access was denied. Allow camera access for this site in " +
      "your browser settings, then try again.";
  }
  if (raw.includes("NotFoundError") || raw.includes("OverconstrainedError")) {
    return "No suitable camera was found on this device.";
  }
  if (raw.includes("NotReadableError") || raw.includes("TrackStartError")) {
    return "The camera is in use by another application. Close it, then try again.";
  }
  if (raw.includes("mediaDevices") || raw.includes("not supported")) {
    return "Scanning needs a camera-capable browser over a secure (https) connection.";
  }
  return "Could not start the camera.";
}
