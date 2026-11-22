import type { Metadata } from "next";
import { Suspense } from "react";
import { UnlockForm } from "@/src/components/UnlockForm";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Unlock Deck",
};

interface UnlockPageProps {
  searchParams: Promise<{ next?: string }>;
}

async function UnlockFormLoader({
  searchParams,
}: {
  searchParams: UnlockPageProps["searchParams"];
}) {
  const resolved = await searchParams;
  return <UnlockForm nextPath={resolved.next ?? "/"} />;
}

export default function UnlockPage({ searchParams }: UnlockPageProps) {
  return (
    <div className="py-6">
      <Suspense
        fallback={
          <Card className="mx-auto max-w-md p-6">
            <Skeleton className="h-44 w-full" />
          </Card>
        }
      >
        <UnlockFormLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
