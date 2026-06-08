"use client";

import { useEffect } from "react";

/**
 * Shared product-image preview popup used by both the Inventory (product
 * management) table and the Cart. Shows the variant's color picture in a
 * 3:4 portrait frame (the catalog photos are 3:4), with the item name +
 * sku/upc/color/size as a caption. Closes on backdrop click or Escape.
 *
 * The image is a Shopify CDN URL — never re-hosted. Falls back to a
 * "Picture not available" panel when the SKU has no synced image.
 */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        <div className="aspect-[3/4] w-full max-w-sm mx-auto bg-[var(--carbon-surface-soft)] border border-carbon-border-soft flex items-center justify-center overflow-hidden">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-carbon-text-muted px-4 text-center">
              <span className="material-symbols-outlined text-7xl opacity-50">hide_image</span>
              <p className="text-base font-semibold">Picture not available</p>
              <p className="text-xs">No image is attached to this product in the catalog.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
