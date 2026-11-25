"use client";

/** Shown when the root layout itself fails. Kept plain: the layout's styles may not have loaded. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-NG">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "3rem 1.5rem",
          maxWidth: 560,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
        <p>
          TownMart couldn&apos;t load this page. Please try again in a moment.
        </p>
        {error.digest ? (
          <p style={{ color: "#555" }}>Error reference: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{ padding: "0.5rem 1rem", marginTop: "1rem" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
