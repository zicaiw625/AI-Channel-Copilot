import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useNonce } from "../lib/nonce";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const to = url.searchParams.get("to") || "";
  if (!to) {
    return new Response("Missing 'to' parameter", { status: 400 });
  }
  return { to };
};

export default function Redirect() {
  const { to } = useLoaderData<typeof loader>();
  const nonce = useNonce();
  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <p style={{ marginBottom: 12 }}>正在跳转到 Shopify 确认页面…</p>
      <a href={to} target="_top" rel="noopener noreferrer">如果没有自动跳转，请点击这里</a>
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `window.top.location.href = ${JSON.stringify(to)};` }}
      />
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
