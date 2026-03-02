-- CreateEnum
CREATE TYPE "EndpointAuditAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

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

-- AddForeignKey
ALTER TABLE "EndpointAuditLog" ADD CONSTRAINT "EndpointAuditLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointAuditLog" ADD CONSTRAINT "EndpointAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
