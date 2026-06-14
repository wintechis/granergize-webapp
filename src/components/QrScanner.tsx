import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { logError } from "../lib/logError.ts";
import { describeCameraError } from "../lib/cameraError.ts";

interface QrScannerProps {
  /** Called with the decoded text once a QR code is read. */
  onResult: (text: string) => void;
  /** Called when the user cancels scanning. */
  onCancel: () => void;
}

const REGION_ID = "qr-scanner-region";

/**
 * Camera-based QR scanner. Lazy-loads `html5-qrcode` so the camera library only
 * ships when scanning is actually used. Requires https or localhost (getUserMedia).
 */
export default function QrScanner({ onResult, onCancel }: QrScannerProps) {
  const [error, setError] = useState<string | null>(null);
  // Keep the latest onResult without re-running the start effect. Assign in an
  // effect, not during render (render must stay pure — react-hooks/refs).
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    let stopped = false;
    let running = false;
    type Scanner = {
      start: (
        camera: { facingMode: string },
        config: { fps: number; qrbox: number },
        onSuccess: (text: string) => void,
        onError: () => void,
      ) => Promise<void>;
      stop: () => Promise<void>;
      clear: () => void;
    };
    let scanner: Scanner | null = null;

    // Release the camera exactly once, and only if it actually started:
    // html5-qrcode's stop() THROWS (synchronously) on a scanner that isn't
    // running — e.g. when the camera permission was denied — and a throwing
    // effect cleanup unmounts the whole React tree (a blank page). So the
    // not-running case must be a no-op, and the sync throw must be contained.
    const release = () => {
      if (!scanner || !running) return;
      running = false;
      try {
        scanner.stop().then(() => scanner?.clear()).catch((err) =>
          logError("stop QR scanner", err)
        );
      } catch (err) {
        logError("stop QR scanner", err);
      }
    };

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (stopped) return;
        scanner = new Html5Qrcode(REGION_ID) as unknown as Scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => {
            if (stopped) return;
            stopped = true;
            release();
            onResultRef.current(decodedText);
          },
          () => {/* per-frame decode failures are normal; ignore */},
        );
        running = true;
        // Closed while the camera was still starting (the permission prompt
        // answered after unmount) — the cleanup already ran, so release here.
        if (stopped) release();
      } catch (err) {
        // The raw failure (DOMException name + library detail) goes to the
        // console; the UI gets a plain actionable sentence.
        logError("start QR scanner camera", err);
        setError(describeCameraError(err));
      }
    })();

    return () => {
      stopped = true;
      release();
    };
  }, []);

  return (
    <Box sx={{ mt: 1 }}>
      <div id={REGION_ID} style={{ width: "100%", maxWidth: 360 }} />
      {error && (
        <Typography color="error" variant="body2" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
      <Button onClick={onCancel} sx={{ mt: 1 }}>Cancel</Button>
    </Box>
  );
}
