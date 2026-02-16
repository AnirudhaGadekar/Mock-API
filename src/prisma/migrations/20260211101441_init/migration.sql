/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `endpoints` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `endpoints` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "endpoints_userId_name_key";

-- AlterTable
ALTER TABLE "endpoints" DROP COLUMN "updatedAt",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "requestCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- CreateIndex
CREATE UNIQUE INDEX "endpoints_name_key" ON "endpoints"("name");

-- CreateIndex
CREATE INDEX "endpoints_deletedAt_idx" ON "endpoints"("deletedAt");
