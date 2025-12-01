import type { ActionFunctionArgs } from "react-router";
import type { TimeRangeKey } from "../lib/aiData";
import type { CopilotIntent } from "../lib/copilot.intent";
import { copilotAnswer } from "../lib/copilot.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, message: "Method not allowed" }, { status: 405 });
  }

  const contentType = request.headers.get("content-type") || "";
  let payload: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }
  } else {
    const form = await request.formData();
    payload = Object.fromEntries(Array.from(form.entries()));
  }

  const allowedIntents = new Set(["ai_performance", "ai_vs_all_aov", "ai_top_products"]);
  const allowedRanges = new Set(["7d", "30d", "90d", "custom"]);
  const intent = (payload.intent as string | undefined) || undefined;
  const range = (payload.range as string | undefined) || undefined;
  const question = (payload.question as string | undefined) || undefined;

  if (intent && !allowedIntents.has(intent)) {
    return Response.json({ ok: false, message: "invalid intent" }, { status: 400 });
  }
  if (range && !allowedRanges.has(range)) {
    return Response.json({ ok: false, message: "invalid range" }, { status: 400 });
  }
  if (question && question.length > 500) {
    return Response.json({ ok: false, message: "question too long" }, { status: 400 });
  }

  const result = await copilotAnswer(request, {
    intent: intent as CopilotIntent | undefined,
    question,
    range: range as TimeRangeKey | undefined,
    from: (payload.from as string | null) || null,
    to: (payload.to as string | null) || null,
  });

  return Response.json(result);
};
