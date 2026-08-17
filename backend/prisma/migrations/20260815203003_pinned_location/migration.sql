-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "gpsAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "gpsLat" DOUBLE PRECISION,
ADD COLUMN     "gpsLng" DOUBLE PRECISION,
ADD COLUMN     "locationAdjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationAdjustedM" DOUBLE PRECISION,
ADD COLUMN     "locationCapturedAt" TIMESTAMP(3);
