import { formatDate } from "@/lib/datetime";
import { AskQuestion } from "./ask-question";

type Q = { id: string; question: string; answer: string | null; askerName: string; createdAt: Date; answeredAt: Date | null; askerUserId: string | null };

/** Questions and answers on a listing page. */
export function QuestionsSection({ kind, id, questions, viewerId, returnTo }: { kind: "product" | "service"; id: string; questions: Q[]; viewerId: string | null; returnTo: string }) {
  return (
    <section aria-labelledby="questions" className="flex flex-col gap-4">
      <h2 id="questions" className="text-xl font-bold">
        Questions and answers
      </h2>
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-col gap-1 py-3 text-sm">
              <p>
                <span className="font-semibold">Q:</span> {q.question}
              </p>
              <p className="text-xs text-muted-foreground">
                {q.askerUserId === viewerId ? "You" : q.askerName} · {formatDate(q.createdAt)}
              </p>
              {q.answer ? (
                <p className="mt-1">
                  <span className="font-semibold">A:</span> {q.answer} <span className="text-xs text-muted-foreground">· the seller{q.answeredAt ? `, ${formatDate(q.answeredAt)}` : ""}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Waiting for the seller to answer. Only you can see this until then.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <AskQuestion kind={kind} id={id} signedIn={viewerId !== null} returnTo={returnTo} />
    </section>
  );
}
