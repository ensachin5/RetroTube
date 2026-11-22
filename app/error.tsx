"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

export default function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("RetroTube UI error boundary:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-6">
      <Card tone="error" role="alert" className="p-6 sm:p-8 space-y-4">
        <Badge tone="tomato">DECK FAULT</Badge>
        <h1 className="font-display text-2xl font-black">
          Something jammed on the deck.
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-ink)]">
          {error.message || "An unexpected client rendering error occurred."}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button variant="primary" size="md" onClick={reset}>
            Try Again
          </Button>
          <Link
            href="/"
            className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--bg-surface)] px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-[var(--text-ink)] no-underline"
          >
            Return Home
          </Link>
        </div>
      </Card>
    </div>
  );
}
