import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { HistoryList } from "@/src/components/HistoryList";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { historyService } from "@/services/history.service";

export const metadata: Metadata = {
  title: "Download History",
};

async function HistoryDataLoader() {
  await connection();
  const items = historyService.list();
  return <HistoryList initialItems={items} />;
}

function HistoryFallback() {
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <Skeleton className="h-16 w-full" />
      </Card>
      <Card className="p-4">
        <Skeleton className="h-16 w-full" />
      </Card>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1
          className="font-display font-black tracking-tight text-[var(--text-ink)]"
          style={{ fontSize: "var(--type-display)", lineHeight: 1.1 }}
        >
          Tape Log & History
        </h1>
        <p className="text-sm sm:text-base text-[var(--text-muted)]">
          Your downloaded tracks and videos saved on your device for quick access.
        </p>
      </header>

      <Suspense fallback={<HistoryFallback />}>
        <HistoryDataLoader />
      </Suspense>
    </div>
  );
}
