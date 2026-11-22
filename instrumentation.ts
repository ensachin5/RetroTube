export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ ensureDbMigrated }, { jobService }] = await Promise.all([
      import("./db/client"),
      import("./services/job.service"),
    ]);

    ensureDbMigrated();
    await jobService.recoverOnStartup();
    jobService.startPeriodicSweeper();
  }
}
