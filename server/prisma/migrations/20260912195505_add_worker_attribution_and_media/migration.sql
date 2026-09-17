-- CreateEnum
CREATE TYPE "MediaAssetSource" AS ENUM ('CLIP_RECORDING', 'MANUAL_UPLOAD');

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "mediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "safety_alerts" ADD COLUMN     "workerId" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cameraId" TEXT,
    "type" "MediaType" NOT NULL,
    "source" "MediaAssetSource" NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
