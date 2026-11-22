import type { Metadata } from "next";
import Link from "next/link";
import { TapeNotFoundIllustration } from "@/src/components/TapeNotFoundIllustration";
import { Card } from "@/src/components/ui/Card";

export const metadata: Metadata = {
  title: "Offline — Tape Not Found",
};

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-lg py-6">
      <Card className="p-6 sm:p-8 text-center space-y-5">
        <TapeNotFoundIllustration code="TAPE NOT FOUND" />
        <div className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-black">
            Offline Signal Lost
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-muted)]">
            RetroTube needs an active connection to reach your server and inspect YouTube
            streams. Reconnect and try reloading the deck.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <Link
            href="/"
            className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--accent-tomato)] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-[var(--on-tomato)] no-underline"
          >
            Back to Deck
          </Link>
          <Link
            href="/history"
            className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--bg-surface-alt)] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider text-[var(--text-ink)] no-underline"
          >
            View History
          </Link>
        </div>
      </Card>
    </div>
  );
}
