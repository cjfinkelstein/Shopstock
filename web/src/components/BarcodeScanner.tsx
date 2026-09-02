import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useEffect, useRef, useState } from "react";

import Sheet from "./Sheet";

const SCAN_ELEMENT_ID = "apex-barcode-reader";

const FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
];

/** Full-screen-ish camera sheet that decodes a product barcode and hands the
 * raw text back to the caller. Requires HTTPS (or localhost) -- getUserMedia
 * is blocked in insecure contexts. */
export default function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // refs so the one-time start effect always calls the LATEST callback
  // without needing to restart the camera on every parent re-render
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let cancelled = false;
    let fired = false;
    const scanner = new Html5Qrcode(SCAN_ELEMENT_ID, {
      formatsToSupport: FORMATS,
      verbose: false,
    });

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 160 } },
        (decodedText) => {
          if (cancelled || fired) return;
          fired = true;
          scanner
            .stop()
            .catch(() => {})
            .finally(() => onDetectedRef.current(decodedText));
        },
        () => {}, // per-frame "no barcode found yet" noise -- ignore
      )
      .catch((err) => {
        if (!cancelled) {
          setError(
            err?.message?.includes("Permission")
              ? "Camera access was denied. Check your browser's site settings and allow the camera."
              : "Couldn't start the camera on this device.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (scanner.isScanning) {
        scanner.stop().then(() => scanner.clear()).catch(() => scanner.clear());
      } else {
        scanner.clear();
      }
    };
  }, []);

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      <div className="space-y-3">
        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <p className="font-semibold">Camera unavailable</p>
            <p className="mt-1">{error}</p>
          </div>
        ) : (
          <p className="text-center text-[13px] text-slate-400 dark:text-slate-500">
            Point the camera at the barcode
          </p>
        )}
        <div
          id={SCAN_ELEMENT_ID}
          className="overflow-hidden rounded-2xl bg-black [&_video]:!w-full [&_video]:rounded-2xl"
        />
      </div>
    </Sheet>
  );
}
