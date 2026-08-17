-- CreateEnum
CREATE TYPE "LandmarkCategory" AS ENUM ('DEPARTMENT', 'BOYS_HOSTEL', 'GIRLS_HOSTEL', 'FACILITY', 'RESIDENCE');

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "landmarkId" TEXT,
ADD COLUMN     "landmarkName" TEXT,
ADD COLUMN     "landmarkNote" TEXT;

-- CreateTable
CREATE TABLE "Landmark" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LandmarkCategory" NOT NULL,
    "zoneCode" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Landmark_name_key" ON "Landmark"("name");

-- CreateIndex
CREATE INDEX "Landmark_category_sortOrder_idx" ON "Landmark"("category", "sortOrder");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "Landmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
