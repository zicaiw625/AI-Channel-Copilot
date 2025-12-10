-- Add index on Session.email for multi-store lookup optimization
-- This index improves the performance of finding linked stores by email

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_email_idx" ON "Session"("email");
