import type { ReportReason } from "@prisma/client";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  prohibited: "Prohibited or illegal item",
  counterfeit: "Fake or counterfeit",
  misleading: "Misleading description or price",
  offensive: "Offensive content",
  scam: "Looks like a scam",
  other: "Something else",
  keyword_match: "Matched a prohibited-items keyword",
};

/** Reasons a shopper can pick (keyword matches are raised automatically). */
export const SHOPPER_REPORT_REASONS = ["prohibited", "counterfeit", "misleading", "offensive", "scam", "other"] as const satisfies readonly ReportReason[];
