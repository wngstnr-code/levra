"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/** A glass sheet over the page. Escape and the backdrop close it, and focus returns to where it was. */
export function Sheet({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const m = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      before?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "squircle animate-sheet-in flex max-h-[92vh] w-full max-w-[620px] flex-col gap-4 overflow-y-auto rounded-t-[32px] border border-white/10 bg-surface-2/85 px-6 pt-3 pb-7 backdrop-blur-2xl outline-none sm:rounded-[32px] sm:px-7",
          className,
        )}
      >
        <span aria-hidden className="mx-auto h-[5px] w-9 shrink-0 rounded-full bg-fg-3" />
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="text-display flex-1 text-2xl font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-full bg-surface-3 px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-[#38383e]">
            {m.common.done}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
