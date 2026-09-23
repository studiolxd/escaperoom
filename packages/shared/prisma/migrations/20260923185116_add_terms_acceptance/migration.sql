-- AlterTable
ALTER TABLE "user" ADD COLUMN     "termsAcceptedVersion" TEXT;

-- CreateTable
CREATE TABLE "termsAcceptance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "termsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ixTermsAcceptanceUser" ON "termsAcceptance"("userId", "acceptedAt" DESC);

-- AddForeignKey
ALTER TABLE "termsAcceptance" ADD CONSTRAINT "termsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
