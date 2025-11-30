import type { ActionFunctionArgs } from "react-router";
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
    } catch {}
  } else {
    const form = await request.formData();
    payload = Object.fromEntries(Array.from(form.entries()));
  }

  const result = await copilotAnswer(request, {
    intent: (payload.intent as string | undefined) as any,
    question: (payload.question as string | undefined) || undefined,
    range: (payload.range as string | undefined) as any,
    from: (payload.from as string | null) || null,
    to: (payload.to as string | null) || null,
  });

  return Response.json(result);
};

