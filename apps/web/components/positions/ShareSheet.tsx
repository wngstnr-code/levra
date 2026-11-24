"use client";

import { Download, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Position } from "@levra/shared/api";
import { useT } from "@/lib/i18n";
import { postOnXUrl, shareCardData, type ShareCardData } from "@/lib/shareCard";
import { chainPath, stockOn } from "@/lib/chains";
import { useChain } from "@/lib/useChain";
import { buttonClass } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

const W = 1200;
const H = 630;

function draw(canvas: HTMLCanvasElement, d: ShareCardData, bg: HTMLImageElement | null, labels: { long: string; short: string; entry: string; now: string; pnl: string; cta: string }) {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, W, H);
  if (bg) ctx.drawImage(bg, 0, 0, W, H);
  const font = (weight: number, size: number) => `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#d4ee8c";
  ctx.beginPath();
  ctx.roundRect(56, 56, 40, 40, 11);
  ctx.fill();
  ctx.fillStyle = "#f5f5f7";
  ctx.font = font(700, 32);
  ctx.fillText("Levra", 110, 88);
  ctx.font = font(700, 52);
  ctx.fillText(d.tokenSymbol, 56, 226);
  const tagX = 56 + ctx.measureText(d.tokenSymbol).width + 20;
  const side = d.side === "long" ? labels.long : labels.short;
  ctx.font = font(700, 22);
  const sw = ctx.measureText(side).width + 28;
  ctx.fillStyle = d.side === "long" ? "#d4ee8c" : "#f5a985";
  ctx.beginPath();
  ctx.roundRect(tagX, 192, sw, 42, 21);
  ctx.fill();
  ctx.fillStyle = "#0a0a0b";
  ctx.fillText(side, tagX + 14, 221);
  ctx.fillStyle = "#a1a1a6";
  ctx.font = font(500, 22);
  ctx.fillText(d.chainName, tagX + sw + 16, 221);
  ctx.fillStyle = d.moveUp ? "#6fd39a" : "#ff8a80";
  ctx.font = font(800, 168);
  ctx.fillText(d.moveText, 48, 410);
  const stats: [string, string][] = d.stats ?? [
    [labels.entry, d.entryText],
    [labels.now, d.nowText],
    [labels.pnl, d.pnlText],
  ];
  stats.forEach(([k, v], i) => {
    const x = 56 + i * 230;
    ctx.fillStyle = "#8e8e93";
    ctx.font = font(600, 18);
    ctx.fillText(k.toUpperCase(), x, 510);
    ctx.fillStyle = "#f5f5f7";
    ctx.font = font(600, 30);
    ctx.fillText(v, x, 552);
  });
  ctx.fillStyle = "#f5f5f7";
  ctx.font = font(600, 22);
  const cw = ctx.measureText(labels.cta).width;
  ctx.fillText(labels.cta, W - 56 - cw, 552);
}

/** A picture of a position or a closed trade for X, drawn in the browser from the numbers the service reports. */
export function ShareSheet({ data, link, text, fileName, note, open, onClose }: { data: ShareCardData; link: string; text: string; fileName: string; note: string; open: boolean; onClose: () => void }) {
  const m = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !canvas.current) return;
    const el = canvas.current;
    const labels = { long: m.trade.long, short: m.trade.short, entry: m.positions.entry, now: m.share.now, pnl: m.positions.pnl, cta: m.share.cta };
    const img = new Image();
    const render = (bg: HTMLImageElement | null) => {
      draw(el, data, bg, labels);
      setUrl(el.toDataURL("image/png"));
    };
    img.onload = () => render(img);
    img.onerror = () => render(null);
    img.src = "/share-bg.jpg";
  }, [open, data.moveText, data.pnlText, data.nowText, JSON.stringify(data.stats)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} title={m.share.title}>
      <canvas ref={canvas} width={W} height={H} className="aspect-[1200/630] w-full rounded-panel bg-ink" aria-label={text} />
      <p className="text-xs text-fg-3">{note}</p>
      <div className="flex gap-2">
        <a href={url ?? undefined} download={fileName} aria-disabled={!url} className={buttonClass("secondary", "md", "flex-1 gap-2")}>
          <Download size={16} aria-hidden /> {m.share.download}
        </a>
        <a href={postOnXUrl(text, link)} target="_blank" rel="noreferrer" className={buttonClass("primary", "md", "flex-1 gap-2")}>
          <Share2 size={16} aria-hidden /> {m.share.postX}
        </a>
      </div>
    </Sheet>
  );
}

/** The share sheet for an open position, linking to its market. */
export function PositionShareSheet({ position, open, onClose }: { position: Position; open: boolean; onClose: () => void }) {
  const m = useT();
  const chain = useChain();
  const stock = stockOn(chain, position.symbol);
  const data = shareCardData(position, stock?.tokenSymbol ?? position.symbol, chain.name);
  const link = typeof window !== "undefined" ? `${window.location.origin}${chainPath(chain, `/markets/${position.symbol}`)}` : "";
  const text = m.share.post(data.tokenSymbol, position.side === "long" ? m.trade.long : m.trade.short, data.moveText);
  return <ShareSheet data={data} link={link} text={text} fileName={`levra-${data.tokenSymbol}-${position.side}.png`} note={m.share.note} open={open} onClose={onClose} />;
}
