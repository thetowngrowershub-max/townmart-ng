import "server-only";
import { withRls } from "@/lib/db";

/**
 * Questions on a listing: answered ones for everyone, plus the viewer's own
 * questions still waiting for the seller. RLS decides what each viewer sees.
 */
export async function listingQuestions(ref: { productId: string } | { serviceId: string }, viewerId: string | null) {
  return withRls({ userId: viewerId }, (tx) =>
    tx.listingQuestion.findMany({
      where: { ...ref, status: "published", OR: [{ answer: { not: null } }, ...(viewerId ? [{ askerUserId: viewerId }] : [])] },
      orderBy: [{ answeredAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, question: true, answer: true, askerName: true, createdAt: true, answeredAt: true, askerUserId: true },
    }),
  );
}
