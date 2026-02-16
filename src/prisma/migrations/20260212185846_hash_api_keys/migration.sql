/*
  Warnings:

  - You are about to drop the column `apiKey` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[api_key]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `api_key` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "users_apiKey_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "apiKey",
ADD COLUMN     "api_key" VARCHAR(64) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");

-- CreateIndex
CREATE INDEX "users_api_key_idx" ON "users"("api_key");
