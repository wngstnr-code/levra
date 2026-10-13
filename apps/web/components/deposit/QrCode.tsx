"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A QR code for an address, drawn as an SVG on a white tile so phone cameras read it in dark mode too. */
export function QrCode({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0a0a0b", light: "#ffffff" } }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div role="img" aria-label={label} className="squircle shrink-0 rounded-3xl bg-white p-4" style={{ width: size + 32, height: size + 32 }}>
      {svg && <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
