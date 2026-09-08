/*
  Warnings:

  - You are about to drop the column `isVerified` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `OtpVerification` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('MAIN', 'OTHERS');

-- CreateEnum
CREATE TYPE "StyleType" AS ENUM ('STYLE_1', 'STYLE_2', 'STYLE_3');

-- DropForeignKey
ALTER TABLE "OtpVerification" DROP CONSTRAINT "OtpVerification_userId_fkey";

-- DropForeignKey
ALTER TABLE "achievements" DROP CONSTRAINT "achievements_event_id_fkey";

-- AlterTable
ALTER TABLE "achievements" ADD COLUMN     "history_id" TEXT,
ALTER COLUMN "event_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "event_type" "EventType" NOT NULL DEFAULT 'MAIN';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isVerified",
ADD COLUMN     "banner_image" TEXT,
ADD COLUMN     "is_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selected_style" "StyleType" NOT NULL DEFAULT 'STYLE_1',
ADD COLUMN     "spotify_link" TEXT,
ADD COLUMN     "style_1" TEXT,
ADD COLUMN     "style_2" TEXT,
ADD COLUMN     "style_3" TEXT;

-- AlterTable
ALTER TABLE "winner_codes" ADD COLUMN     "history_id" TEXT,
ALTER COLUMN "event_id" DROP NOT NULL;

-- DropTable
DROP TABLE "OtpVerification";

-- CreateTable
CREATE TABLE "otp_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "history" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "location" TEXT NOT NULL,
    "cover_image" TEXT NOT NULL,
    "event_date" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "history_event_id_key" ON "history"("event_id");

-- AddForeignKey
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "history" ADD CONSTRAINT "history_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_codes" ADD CONSTRAINT "winner_codes_history_id_fkey" FOREIGN KEY ("history_id") REFERENCES "history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_history_id_fkey" FOREIGN KEY ("history_id") REFERENCES "history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
