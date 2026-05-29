"use client";

import { useEffect } from "react";

/**
 * Dev-only a11y reporter. Dynamic-imports @axe-core/react so it never
 * enters the production bundle. Logs violations to the browser console;
 * Tim opens DevTools console on each page during the P3.10 gate walkthrough.
 *
 * Tree-shaken at production build time: the dynamic import only fires
 * when NODE_ENV === 'development'.
 */
export function AxeReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ default: axe }, React, ReactDOM] = await Promise.all([
          import("@axe-core/react"),
          import("react"),
          import("react-dom"),
        ]);
        if (cancelled) return;
        axe(React, ReactDOM, 1000);
      } catch {
        // dev-only; silent on init failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
