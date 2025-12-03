-- Track uninstall/reinstall timestamps for billing recovery
ALTER TABLE "ShopBillingState"
ADD COLUMN IF NOT EXISTS "lastUninstalledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastReinstalledAt" TIMESTAMP(3);

