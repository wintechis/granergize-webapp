import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";

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
  // Keep the latest onResult without re-running the start effect.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let stopped = false;
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
            scanner?.stop().then(() => scanner?.clear()).catch(() => {});
            onResultRef.current(decodedText);
          },
          () => {/* per-frame decode failures are normal; ignore */},
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not start the camera.",
        );
      }
    })();

    return () => {
      stopped = true;
      scanner?.stop().then(() => scanner?.clear()).catch(() => {});
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
