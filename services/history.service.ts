import { AppError, ERROR_CODES } from "@/lib/errors";
import { historyRepo, type HistoryItemWithDetails } from "@/repositories/history.repo";

export const historyService = {
  list(): HistoryItemWithDetails[] {
    return historyRepo.listLatest(50);
  },

  deleteById(id: number): { deleted: true; id: number } {
    const existing = historyRepo.findById(id);
    if (!existing) {
      throw new AppError({
        code: ERROR_CODES.JOB_NOT_FOUND,
        status: 404,
        message: "History entry was not found.",
      });
    }

    historyRepo.deleteById(id);
    return { deleted: true, id };
  },

  clearAll(): { cleared: number } {
    const cleared = historyRepo.clearAll();
    return { cleared };
  },
};
