import { jsonOk, withApiHandler } from "@/lib/http";
import { historyService } from "@/services/history.service";

export const GET = withApiHandler({ route: "/api/history" }, async (_request, ctx) => {
  const items = historyService.list();
  return jsonOk({ items }, ctx.requestId, 200);
});

export const DELETE = withApiHandler({ route: "/api/history" }, async (_request, ctx) => {
  const result = historyService.clearAll();
  return jsonOk(result, ctx.requestId, 200);
});
