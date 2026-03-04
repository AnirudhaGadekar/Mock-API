-- Improve RequestLog and EndpointAuditLog query performance for endpoint timeline views

DO $$
BEGIN
    IF to_regclass('"RequestLog"') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS "RequestLog_endpointId_createdAt_idx" ON "RequestLog"("endpointId", "createdAt")';
        EXECUTE 'CREATE INDEX IF NOT EXISTS "RequestLog_userId_idx" ON "RequestLog"("userId")';
    END IF;

    IF to_regclass('"EndpointAuditLog"') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS "EndpointAuditLog_endpointId_createdAt_idx" ON "EndpointAuditLog"("endpointId", "createdAt")';
    END IF;
END $$;
