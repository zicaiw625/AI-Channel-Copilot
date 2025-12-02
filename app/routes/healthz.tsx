import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
};

export default function Healthz() {
  return null;
}
