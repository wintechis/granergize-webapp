/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { describeCameraError } from "./cameraError.ts";

Deno.test("describeCameraError: html5-qrcode's plain-string denial → actionable sentence", () => {
  // The exact string the library rejects with when the permission is denied.
  const msg = describeCameraError(
    "Error getting userMedia, error = NotAllowedError: The request is not " +
      "allowed by the user agent or the platform in the current context.",
  );
  assert.match(msg, /camera access was denied/i);
  assert.match(msg, /try again/i);
});

Deno.test("describeCameraError: a NotAllowedError DOMException maps the same way", () => {
  const err = new DOMException("Permission denied", "NotAllowedError");
  assert.match(describeCameraError(err), /camera access was denied/i);
});

Deno.test("describeCameraError: no camera on the device", () => {
  assert.match(
    describeCameraError(new DOMException("no device", "NotFoundError")),
    /no suitable camera/i,
  );
});

Deno.test("describeCameraError: camera already in use", () => {
  assert.match(
    describeCameraError(new DOMException("busy", "NotReadableError")),
    /in use by another application/i,
  );
});

Deno.test("describeCameraError: insecure context / unsupported browser", () => {
  assert.match(
    describeCameraError(
      new TypeError("navigator.mediaDevices is undefined"),
    ),
    /secure \(https\)/i,
  );
});

Deno.test("describeCameraError: anything unrecognised falls back generically", () => {
  assert.equal(describeCameraError("boom"), "Could not start the camera.");
  assert.equal(describeCameraError(undefined), "Could not start the camera.");
});
