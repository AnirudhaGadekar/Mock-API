ALTER TABLE "User"
ADD COLUMN "username" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_username_idx" ON "User"("username");
