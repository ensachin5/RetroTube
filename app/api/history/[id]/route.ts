import { z } from "zod";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { jsonOk, withApiHandler } from "@/lib/http";
import { historyService } from "@/services/history.service";

const idParamSchema = z.coerce.number().int().positive("Invalid history id.");

export const DELETE = withApiHandler<{ id: string }>(
  { route: "/api/history/[id]" },
  async (_request, ctx, routeContext) => {
    const { id } = await routeContext.params;
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message: "History id must be a positive integer.",
      });
    }

    const result = historyService.deleteById(parsed.data);
    return jsonOk(result, ctx.requestId, 200);
  },
);
