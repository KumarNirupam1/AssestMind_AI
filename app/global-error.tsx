"use client";

import * as React from "react";

/**
 * Last-resort boundary for failures inside the root layout. It replaces the
 * document shell, so it must render its own <html>/<body> and cannot rely on
 * the app's CSS pipeline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] root layout error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
          AssetMind AI could not start
        </h1>
        <p style={{ maxWidth: "32rem", fontSize: "0.875rem", color: "#6b7280", margin: 0 }}>
          A fatal error interrupted the application shell. Reloading usually resolves it.
        </p>
        {error.digest ? (
          <code style={{ fontSize: "0.75rem", color: "#6b7280" }}>reference: {error.digest}</code>
        ) : null}
        <button
          onClick={reset}
          style={{
            borderRadius: "0.5rem",
            border: "1px solid #d1d5db",
            background: "#111827",
            color: "#f9fafb",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
