const DEFAULT_PLATFORM = "shopify";

export const getPlatform = () => DEFAULT_PLATFORM;

export const isDemoMode = () => process.env.DEMO_MODE === "true";

export const allowDemoData = () => isDemoMode();
