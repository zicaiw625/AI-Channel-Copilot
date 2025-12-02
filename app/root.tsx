import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect } from "react";
import { useUILanguage } from "./lib/useUILanguage";
import { useNonce } from "./lib/nonce";

export default function App() {
  const uiLanguage = useUILanguage("中文");
  const nonce = useNonce();
  useEffect(() => {
    const lang = uiLanguage === "English" ? "en" : "zh";
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [uiLanguage]);
  return (
    <html lang="zh">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        {(() => {
          const ScriptsAny: any = Scripts;
          return <ScriptsAny nonce={nonce} />;
        })()}
      </body>
    </html>
  );
}
