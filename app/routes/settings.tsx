import { redirect, type LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // 保留查询参数（如 hmac, shop, embedded 等）
  return redirect(`/app/additional${url.search}`);
};

