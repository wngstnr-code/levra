"use client";

/** Replaces the whole app when even the layout fails, so it carries its own plain text and styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0a0b", color: "#f5f5f7", fontFamily: "-apple-system, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Levra could not load</h1>
          <p style={{ color: "#a1a1a6" }}>Your funds are not affected. You can still close positions on Morpho directly.</p>
          <p style={{ color: "#a1a1a6" }}>Levra tidak bisa dimuat. Dana kamu aman, dan posisi tetap bisa ditutup langsung di Morpho.</p>
          <button onClick={reset} style={{ marginTop: 16, height: 44, padding: "0 24px", borderRadius: 999, border: 0, background: "#d4ee8c", color: "#0a0a0b", fontWeight: 600 }}>
            Try again · Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
