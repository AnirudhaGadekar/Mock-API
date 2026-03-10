-- DropForeignKey
ALTER TABLE "Endpoint" DROP CONSTRAINT "Endpoint_workspaceId_fkey";

-- AlterTable
ALTER TABLE "Endpoint" ALTER COLUMN "workspaceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
