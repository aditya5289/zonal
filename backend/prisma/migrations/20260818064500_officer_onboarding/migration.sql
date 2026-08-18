-- Officers self-register and wait for the same admin verification workers do.
-- Until now they could only be created directly in the database, which meant
-- there was no way to onboard one from the app at all.
--
-- The zone recorded here is the one APPLIED FOR. Ownership stays on
-- Zone.officerId and is set only when an admin approves, so a pending
-- application cannot lock a zone against every other candidate.

CREATE TABLE "OfficerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "idProofUrl" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficerProfile_userId_key" ON "OfficerProfile"("userId");

CREATE INDEX "OfficerProfile_zoneId_approvalStatus_idx"
    ON "OfficerProfile"("zoneId", "approvalStatus");

ALTER TABLE "OfficerProfile" ADD CONSTRAINT "OfficerProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficerProfile" ADD CONSTRAINT "OfficerProfile_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Officers that already exist were created by hand and are, by definition,
-- approved. Give them a matching profile so the admin screens show a complete
-- roster rather than only newcomers.
INSERT INTO "OfficerProfile" ("id", "userId", "zoneId", "approvalStatus", "approvedAt", "createdAt", "updatedAt")
SELECT
    'ofc_' || substr(md5(random()::text || u."id"), 1, 21),
    u."id",
    z."id",
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
FROM "User" u
JOIN "Zone" z ON z."officerId" = u."id"
WHERE u."role" = 'OFFICER';
