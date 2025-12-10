// CSS 模块类型声明
declare module "*.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Shopify Polaris 自定义元素类型声明
declare namespace JSX {
  interface IntrinsicElements {
    "s-page": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        heading?: string;
        subtitle?: string;
        backAction?: { content: string; url: string };
        primaryAction?: { content: string; onAction?: () => void };
        secondaryActions?: Array<{ content: string; onAction?: () => void }>;
      },
      HTMLElement
    >;
    "s-card": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        title?: string;
        sectioned?: boolean;
      },
      HTMLElement
    >;
    "s-layout": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        sectioned?: boolean;
      },
      HTMLElement
    >;
    "s-stack": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        vertical?: boolean;
        spacing?: "extraTight" | "tight" | "baseTight" | "base" | "loose" | "extraLoose";
        alignment?: "leading" | "trailing" | "center" | "fill" | "baseline";
        distribution?: "equalSpacing" | "leading" | "trailing" | "center" | "fill" | "fillEvenly";
      },
      HTMLElement
    >;
  }
}
