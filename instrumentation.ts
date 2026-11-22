export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ ensureDbMigrated }, { jobService }, { batchService }] = await Promise.all([
      import("./db/client"),
      import("./services/job.service"),
      import("./services/batch.service"),
    ]);

    ensureDbMigrated();
    await jobService.recoverOnStartup();
    await batchService.recoverInterruptedBatches();

    // In long-running node servers (VPS/Docker), start the background file sweeper
    if (process.env.VERCEL !== "1") {
      jobService.startPeriodicSweeper();
    }
  }
}
