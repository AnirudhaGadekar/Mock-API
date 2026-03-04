-- CreateEnum
CREATE TYPE "EndpointAuditAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

-- Ensure enum exists in shadow/fresh databases before table creation.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceType') THEN
        CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'TEAM');
    END IF;
END $$;

-- CreateTable
CREATE TABLE "EndpointAuditLog" (
    "id" TEXT NOT NULL,
    "action" "EndpointAuditAction" NOT NULL,
    "endpointId" TEXT,
    "endpointSlug" TEXT,
    "endpointName" TEXT,
    "actorUserId" TEXT,
    "workspaceType" "WorkspaceType" NOT NULL,
    "teamId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndpointAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndpointAuditLog_endpointId_idx" ON "EndpointAuditLog"("endpointId");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_endpointSlug_idx" ON "EndpointAuditLog"("endpointSlug");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_actorUserId_idx" ON "EndpointAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_createdAt_idx" ON "EndpointAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_workspaceType_idx" ON "EndpointAuditLog"("workspaceType");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_teamId_idx" ON "EndpointAuditLog"("teamId");

-- AddForeignKey (defensive for mixed legacy/current migration histories)
DO $$
BEGIN
    BEGIN
        ALTER TABLE "EndpointAuditLog"
            ADD CONSTRAINT "EndpointAuditLog_endpointId_fkey"
            FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION
        WHEN duplicate_object OR undefined_table OR undefined_object OR datatype_mismatch THEN
            NULL;
    END;

    BEGIN
        ALTER TABLE "EndpointAuditLog"
            ADD CONSTRAINT "EndpointAuditLog_actorUserId_fkey"
            FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION
        WHEN duplicate_object OR undefined_table OR undefined_object OR datatype_mismatch THEN
            NULL;
    END;
END $$;
