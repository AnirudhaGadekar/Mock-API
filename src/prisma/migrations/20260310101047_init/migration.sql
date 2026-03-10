-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('ANONYMOUS', 'LOCAL', 'GOOGLE', 'GITHUB', 'EMAIL_OTP');

-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "EndpointAuditAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "RecorderProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApiCredentialPrincipalType" AS ENUM ('USER', 'SERVICE');

-- CreateEnum
CREATE TYPE "RecorderMode" AS ENUM ('OFF', 'SAMPLED', 'FULL');

-- CreateEnum
CREATE TYPE "RecorderStatus" AS ENUM ('ACTIVE', 'STOPPED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT,
    "picture" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'ANONYMOUS',
    "googleId" TEXT,
    "githubId" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "currentWorkspaceType" "WorkspaceType" NOT NULL DEFAULT 'PERSONAL',
    "currentTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "workspaceType" "WorkspaceType" NOT NULL DEFAULT 'PERSONAL',
    "teamId" TEXT,
    "workspaceId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ServiceApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "settings" JSONB,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "teamId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

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
    "workspaceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndpointAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSecurityEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "workspaceType" "WorkspaceType" NOT NULL DEFAULT 'PERSONAL',
    "teamId" TEXT,
    "workspaceId" TEXT,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "diff" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditSecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "normalizedPath" TEXT,
    "queryParams" JSONB,
    "headers" JSONB,
    "body" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "responseStatus" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecorderProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recorderSessionId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "normalizedPath" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proposedRule" JSONB NOT NULL,
    "sample" JSONB,
    "status" "RecorderProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecorderProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecorderSession" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "workspaceType" "WorkspaceType" NOT NULL DEFAULT 'PERSONAL',
    "teamId" TEXT,
    "workspaceId" TEXT,
    "status" "RecorderStatus" NOT NULL DEFAULT 'ACTIVE',
    "mode" "RecorderMode" NOT NULL DEFAULT 'SAMPLED',
    "maxRequests" INTEGER,
    "maxBytes" INTEGER,
    "ttlExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecorderSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "personalOwnerUserId" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "principalType" "ApiCredentialPrincipalType" NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecorderSessionEndpoint" (
    "id" TEXT NOT NULL,
    "recorderSessionId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecorderSessionEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_verificationToken_key" ON "User"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKeyHash_key" ON "User"("apiKeyHash");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_apiKeyHash_idx" ON "User"("apiKeyHash");

-- CreateIndex
CREATE INDEX "User_googleId_idx" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_githubId_idx" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceApiKey_keyHash_key" ON "ServiceApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ServiceApiKey_userId_idx" ON "ServiceApiKey"("userId");

-- CreateIndex
CREATE INDEX "ServiceApiKey_teamId_idx" ON "ServiceApiKey"("teamId");

-- CreateIndex
CREATE INDEX "ServiceApiKey_workspaceId_idx" ON "ServiceApiKey"("workspaceId");

-- CreateIndex
CREATE INDEX "ServiceApiKey_workspaceType_idx" ON "ServiceApiKey"("workspaceType");

-- CreateIndex
CREATE INDEX "ServiceApiKey_revokedAt_idx" ON "ServiceApiKey"("revokedAt");

-- CreateIndex
CREATE INDEX "ServiceApiKey_keyHash_revokedAt_idx" ON "ServiceApiKey"("keyHash", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_slug_idx" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_token_idx" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_idx" ON "TeamInvite"("teamId");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_acceptedAt_expiresAt_idx" ON "TeamInvite"("teamId", "acceptedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_slug_key" ON "Endpoint"("slug");

-- CreateIndex
CREATE INDEX "Endpoint_slug_idx" ON "Endpoint"("slug");

-- CreateIndex
CREATE INDEX "Endpoint_userId_idx" ON "Endpoint"("userId");

-- CreateIndex
CREATE INDEX "Endpoint_teamId_idx" ON "Endpoint"("teamId");

-- CreateIndex
CREATE INDEX "Endpoint_workspaceId_idx" ON "Endpoint"("workspaceId");

-- CreateIndex
CREATE INDEX "Endpoint_userId_createdAt_idx" ON "Endpoint"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Endpoint_teamId_createdAt_idx" ON "Endpoint"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "Endpoint_userId_name_idx" ON "Endpoint"("userId", "name");

-- CreateIndex
CREATE INDEX "Endpoint_teamId_name_idx" ON "Endpoint"("teamId", "name");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_endpointId_idx" ON "EndpointAuditLog"("endpointId");

-- CreateIndex
CREATE INDEX "EndpointAuditLog_endpointId_createdAt_idx" ON "EndpointAuditLog"("endpointId", "createdAt");

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

-- CreateIndex
CREATE INDEX "EndpointAuditLog_workspaceId_idx" ON "EndpointAuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_actorUserId_idx" ON "AuditSecurityEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_action_idx" ON "AuditSecurityEvent"("action");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_targetType_targetId_idx" ON "AuditSecurityEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_workspaceType_teamId_idx" ON "AuditSecurityEvent"("workspaceType", "teamId");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_workspaceId_idx" ON "AuditSecurityEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_result_idx" ON "AuditSecurityEvent"("result");

-- CreateIndex
CREATE INDEX "AuditSecurityEvent_createdAt_idx" ON "AuditSecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Otp_email_idx" ON "Otp"("email");

-- CreateIndex
CREATE INDEX "RequestLog_endpointId_idx" ON "RequestLog"("endpointId");

-- CreateIndex
CREATE INDEX "RequestLog_endpointId_createdAt_idx" ON "RequestLog"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_endpointId_responseStatus_createdAt_idx" ON "RequestLog"("endpointId", "responseStatus", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_endpointId_normalizedPath_createdAt_idx" ON "RequestLog"("endpointId", "normalizedPath", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_userId_idx" ON "RequestLog"("userId");

-- CreateIndex
CREATE INDEX "RecorderProposal_workspaceId_status_createdAt_idx" ON "RecorderProposal"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecorderProposal_recorderSessionId_status_createdAt_idx" ON "RecorderProposal"("recorderSessionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecorderProposal_endpointId_normalizedPath_status_idx" ON "RecorderProposal"("endpointId", "normalizedPath", "status");

-- CreateIndex
CREATE INDEX "RecorderProposal_normalizedPath_idx" ON "RecorderProposal"("normalizedPath");

-- CreateIndex
CREATE INDEX "RecorderProposal_status_idx" ON "RecorderProposal"("status");

-- CreateIndex
CREATE INDEX "RecorderProposal_createdAt_idx" ON "RecorderProposal"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecorderProposal_recorderSessionId_endpointId_method_normal_key" ON "RecorderProposal"("recorderSessionId", "endpointId", "method", "normalizedPath", "responseStatus");

-- CreateIndex
CREATE INDEX "RecorderSession_createdById_idx" ON "RecorderSession"("createdById");

-- CreateIndex
CREATE INDEX "RecorderSession_teamId_idx" ON "RecorderSession"("teamId");

-- CreateIndex
CREATE INDEX "RecorderSession_workspaceId_idx" ON "RecorderSession"("workspaceId");

-- CreateIndex
CREATE INDEX "RecorderSession_status_idx" ON "RecorderSession"("status");

-- CreateIndex
CREATE INDEX "RecorderSession_ttlExpiresAt_idx" ON "RecorderSession"("ttlExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_teamId_key" ON "Workspace"("teamId");

-- CreateIndex
CREATE INDEX "Workspace_type_idx" ON "Workspace"("type");

-- CreateIndex
CREATE INDEX "Workspace_personalOwnerUserId_idx" ON "Workspace"("personalOwnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_type_personalOwnerUserId_key" ON "Workspace"("type", "personalOwnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_keyHash_key" ON "ApiCredential"("keyHash");

-- CreateIndex
CREATE INDEX "ApiCredential_userId_idx" ON "ApiCredential"("userId");

-- CreateIndex
CREATE INDEX "ApiCredential_workspaceId_idx" ON "ApiCredential"("workspaceId");

-- CreateIndex
CREATE INDEX "ApiCredential_revokedAt_idx" ON "ApiCredential"("revokedAt");

-- CreateIndex
CREATE INDEX "ApiCredential_workspaceId_revokedAt_idx" ON "ApiCredential"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "RecorderSessionEndpoint_endpointId_idx" ON "RecorderSessionEndpoint"("endpointId");

-- CreateIndex
CREATE INDEX "RecorderSessionEndpoint_recorderSessionId_idx" ON "RecorderSessionEndpoint"("recorderSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "RecorderSessionEndpoint_recorderSessionId_endpointId_key" ON "RecorderSessionEndpoint"("recorderSessionId", "endpointId");

-- AddForeignKey
ALTER TABLE "ServiceApiKey" ADD CONSTRAINT "ServiceApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceApiKey" ADD CONSTRAINT "ServiceApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointAuditLog" ADD CONSTRAINT "EndpointAuditLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointAuditLog" ADD CONSTRAINT "EndpointAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointAuditLog" ADD CONSTRAINT "EndpointAuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSecurityEvent" ADD CONSTRAINT "AuditSecurityEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSecurityEvent" ADD CONSTRAINT "AuditSecurityEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderProposal" ADD CONSTRAINT "RecorderProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderProposal" ADD CONSTRAINT "RecorderProposal_recorderSessionId_fkey" FOREIGN KEY ("recorderSessionId") REFERENCES "RecorderSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderProposal" ADD CONSTRAINT "RecorderProposal_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderProposal" ADD CONSTRAINT "RecorderProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderSession" ADD CONSTRAINT "RecorderSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderSession" ADD CONSTRAINT "RecorderSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_personalOwnerUserId_fkey" FOREIGN KEY ("personalOwnerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "ApiCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderSessionEndpoint" ADD CONSTRAINT "RecorderSessionEndpoint_recorderSessionId_fkey" FOREIGN KEY ("recorderSessionId") REFERENCES "RecorderSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecorderSessionEndpoint" ADD CONSTRAINT "RecorderSessionEndpoint_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
