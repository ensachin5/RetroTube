import { jsonOk, withApiHandler } from "@/lib/http";
import { healthService } from "@/services/health.service";

export const GET = withApiHandler(
  { route: "/api/health", publicRoute: true },
  async (_request, ctx) => {
    const report = await healthService.check();
    const status = report.status === "ok" ? 200 : 503;
    return jsonOk(report, ctx.requestId, status);
  },
);
