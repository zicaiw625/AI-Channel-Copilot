import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  params.set("tab", "recommendations");
  throw redirect(`/app/discovery?${params.toString()}`);
};
