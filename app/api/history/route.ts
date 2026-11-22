import { jsonOk, withApiHandler } from "@/lib/http";
import { historyService } from "@/services/history.service";

export const GET = withApiHandler({ route: "/api/history" }, async (_request, ctx) => {
  const items = historyService.list();
  return jsonOk({ items }, ctx.requestId, 200);
});
