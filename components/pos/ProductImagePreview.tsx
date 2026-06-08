"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared product-image preview popup used by both the Inventory (product
 * management) table and the Cart. Shows the variant's color picture in a
 * 3:4 portrait frame (the catalog photos are 3:4), with a magnifier:
 *   • + / − buttons (and a reset) to zoom in/out
 *   • mouse-wheel to zoom
 *   • drag to pan when zoomed in (clamped so the image can't leave the frame)
 *   • double-click to toggle 1× / 2.5×
 * Closes on backdrop click or Escape.
 *
 * The image is a Shopify CDN URL — never re-hosted. Falls back to a
 * "Picture not available" panel when the SKU has no synced image.
 */
const MIN_SCALE = 1;
const MAX_SCALE = 5;

export function ProductImagePreview({
  imageUrl,
  title,
  subtitle,
  onClose,
}: {
  imageUrl: string | null;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // `animate` drives the CSS transition: smooth for discrete zoom steps,
  // OFF while dragging so panning tracks the cursor 1:1 (no lag/jitter).
  const [animate, setAnimate] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Keep the pan within bounds so the scaled image always covers the frame.
  const clamp = useCallback((x: number, y: number, s: number) => {
    const el = frameRef.current;
    if (!el || s <= MIN_SCALE) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const maxX = ((s - 1) * r.width) / 2;
    const maxY = ((s - 1) * r.height) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const reset = useCallback(() => {
    setAnimate(true);
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const zoomTo = useCallback(
    (next: number) => {
      setAnimate(true);
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +next.toFixed(2)));
      setScale(ns);
      // Re-clamp the existing pan to the new (possibly smaller) bounds.
      setTx((x) => clamp(x, 0, ns).x);
      setTy((y) => clamp(0, y, ns).y);
    },
    [clamp],
  );
  const zoomBy = useCallback((delta: number) => zoomTo(scale + delta), [zoomTo, scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomBy(0.5);
      else if (e.key === "-" || e.key === "_") zoomBy(-0.5);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomBy, reset]);

  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    zoomBy(e.deltaY > 0 ? -0.3 : 0.3);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= MIN_SCALE) return;
    draggingRef.current = true;
    setAnimate(false); // no transition while dragging
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    // Functional updates so several moves per frame can't drift off a stale value.
    setTx((x) => clamp(x + dx, 0, scale).x);
    setTy((y) => clamp(0, y + dy, scale).y);
  };
  const endDrag = () => {
    draggingRef.current = false;
  };

  const zoomed = scale > MIN_SCALE;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-md w-full p-6 shadow-xl border border-carbon-border-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-carbon-text truncate">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-carbon-text-muted font-mono mt-0.5 truncate">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-carbon-text-muted hover:text-carbon-text text-2xl leading-none px-2 shrink-0"
          >
            ×
          </button>
        </div>

        <div
          ref={frameRef}
          className={`relative aspect-[3/4] w-full max-w-sm mx-auto bg-[var(--carbon-surface-soft)] border border-carbon-border-soft overflow-hidden touch-none select-none ${
            imageUrl ? (zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in") : ""
          }`}
          onWheel={imageUrl ? onWheel : undefined}
          onPointerDown={imageUrl ? onPointerDown : undefined}
          onPointerMove={imageUrl ? onPointerMove : undefined}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
          onDoubleClick={imageUrl ? () => (zoomed ? reset() : zoomTo(2.5)) : undefined}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              draggable={false}
              className="w-full h-full object-cover will-change-transform"
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                transition: animate ? "transform 120ms ease-out" : "none",
                transformOrigin: "center center",
              }}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-carbon-text-muted px-4 text-center">
              <span className="material-symbols-outlined text-7xl opacity-50">hide_image</span>
              <p className="text-base font-semibold">Picture not available</p>
              <p className="text-xs">No image is attached to this product in the catalog.</p>
            </div>
          )}

          {/* Magnifier controls — bottom-center overlay. Stop pointer events
              from bubbling so tapping a control never starts a drag. */}
          {imageUrl ? (
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-1 text-white"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => zoomBy(-0.5)}
                disabled={scale <= MIN_SCALE}
                aria-label="Zoom out"
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">zoom_out</span>
              </button>
              <span className="min-w-[2.75rem] text-center font-mono text-xs tabular-nums">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(0.5)}
                disabled={scale >= MAX_SCALE}
                aria-label="Zoom in"
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">zoom_in</span>
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={!zoomed}
                aria-label="Reset zoom"
                className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">restart_alt</span>
              </button>
            </div>
          ) : null}
        </div>

        {imageUrl ? (
          <p className="mt-2 text-center text-[11px] text-carbon-text-muted">
            Scroll or use +/− to zoom · drag to pan · double-click to toggle
          </p>
        ) : null}
      </div>
    </div>
  );
}
