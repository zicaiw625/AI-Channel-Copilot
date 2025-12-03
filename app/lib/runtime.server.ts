import { readAppFlags } from "./env.server";

const DEFAULT_PLATFORM = "shopify";

export const getPlatform = () => DEFAULT_PLATFORM;

export const isDemoMode = () => readAppFlags().demoMode;

export const allowDemoData = () => isDemoMode();
