import { Suspense } from "react";
import { FetchWorkspace } from "@/src/components/FetchWorkspace";
import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { extractShareUrlParam } from "@/src/lib/client-url";

interface HomePageProps {
  searchParams: Promise<{
    url?: string;
    text?: string;
    title?: string;
  }>;
}

async function HomeWorkspaceLoader({
  searchParams,
}: {
  searchParams: HomePageProps["searchParams"];
}) {
  const resolved = await searchParams;
  const initialUrl = extractShareUrlParam(resolved.url, resolved.text);
  return <FetchWorkspace initialUrl={initialUrl} />;
}

function HomeFallback() {
  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-12 w-full" />
    </Card>
  );
}

export default function HomePage({ searchParams }: HomePageProps) {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeWorkspaceLoader searchParams={searchParams} />
    </Suspense>
  );
}
