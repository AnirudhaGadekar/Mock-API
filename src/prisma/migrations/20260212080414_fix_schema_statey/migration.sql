/*
  Warnings:

  - A unique constraint covering the columns `[name,userId]` on the table `endpoints` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "endpoints_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "endpoints_name_userId_key" ON "endpoints"("name", "userId");
