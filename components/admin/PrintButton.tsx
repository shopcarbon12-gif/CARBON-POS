"use client";

/** Prints the current page (report pages hide nav/filters when printing). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="carbon-btn-secondary tap px-4 flex items-center justify-center gap-2 text-sm uppercase tracking-wider font-bold"
    >
      <span className="material-symbols-outlined text-base">print</span>
      Print
    </button>
  );
}
