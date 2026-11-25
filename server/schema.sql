-- PostgreSQL Schema for SAP Role Header & Authorization CAP Ingestion
-- Metadata Source: SAP CAP /role-service/$metadata (HMF 2023)

-- 1. Table: RoleHeaders (Source: ZROLE_HEADER)
CREATE TABLE IF NOT EXISTS "RoleHeaders" (
    "AgrName" VARCHAR(30) PRIMARY KEY,
    "ParentAgr" VARCHAR(30),
    "CreateUsr" VARCHAR(12),
    "CreateDat" DATE,
    "CreateTim" TIME,
    "CreateTmp" TIMESTAMPTZ,
    "ChangeUsr" VARCHAR(12),
    "ChangeDat" DATE,
    "ChangeTim" TIME,
    "ChangeTmp" TIMESTAMPTZ,
    "Attributes" VARCHAR(10),
    "FLAG_TYPE" VARCHAR(10),
    "RoleType" VARCHAR(10),
    "line" VARCHAR(5),
    "Text" VARCHAR(80),
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table: RoleAuthorizations (Source: ZROLE_AUTHORIZATIONS)
CREATE TABLE IF NOT EXISTS "RoleAuthorizations" (
    "AgrName" VARCHAR(30) NOT NULL REFERENCES "RoleHeaders"("AgrName") ON DELETE CASCADE,
    "Counter" VARCHAR(6) NOT NULL,
    "Object" VARCHAR(10),
    "Auth" VARCHAR(12),
    "Variant" VARCHAR(4),
    "Field" VARCHAR(10),
    "Low" VARCHAR(40),
    "High" VARCHAR(40),
    "Modified" VARCHAR(1),
    "Deleted" BOOLEAN DEFAULT FALSE,
    "Copied" BOOLEAN DEFAULT FALSE,
    "Neu" VARCHAR(1),
    "Node" VARCHAR(6),
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("AgrName", "Counter")
);

-- 3. Table: RoleOrgData (Source: ZROLE_ORG_DATA)
CREATE TABLE IF NOT EXISTS "RoleOrgData" (
    "AgrName" VARCHAR(30) NOT NULL REFERENCES "RoleHeaders"("AgrName") ON DELETE CASCADE,
    "Counter" VARCHAR(6) NOT NULL,
    "Varbl" VARCHAR(40),
    "Low" VARCHAR(40),
    "High" VARCHAR(40),
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("AgrName", "Counter")
);

-- 4. Table: RoleTCodes (Source: ZROLE_TCODES)
CREATE TABLE IF NOT EXISTS "RoleTCodes" (
    "AgrName" VARCHAR(30) NOT NULL REFERENCES "RoleHeaders"("AgrName") ON DELETE CASCADE,
    "Counter" VARCHAR(6) NOT NULL,
    "Reporttype" VARCHAR(2),
    "Report" VARCHAR(48),
    "ParMenu" VARCHAR(40),
    "ParReport" VARCHAR(40),
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("AgrName", "Counter")
);

-- 5. Table: RoleUserAssignments (Source: RoleUserAssignments / ZGW_ROLES_MANAGEMENT_SRV)
CREATE TABLE IF NOT EXISTS "RoleUserAssignments" (
    "AgrName" VARCHAR(30) NOT NULL,
    "Uname" VARCHAR(12) NOT NULL,
    "FromDat" DATE,
    "ToDat" DATE,
    "OrgFlag" VARCHAR(10),
    "ColFlag" VARCHAR(10),
    "Department" VARCHAR(80),
    "FullName" VARCHAR(120),
    "Locked" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("AgrName", "Uname")
);

-- 6. Table: SapSystems (Connected S/4HANA & BTP CAP Systems)
CREATE TABLE IF NOT EXISTS "SapSystems" (
    "id" VARCHAR(50) PRIMARY KEY,
    "name" VARCHAR(150) NOT NULL,
    "sid" VARCHAR(10) NOT NULL,
    "client" VARCHAR(10) NOT NULL,
    "tier" VARCHAR(20) NOT NULL,
    "deployment" VARCHAR(40) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "authType" VARCHAR(50) NOT NULL,
    "host" TEXT NOT NULL,
    "serviceRoot" TEXT,
    "destination" VARCHAR(80),
    "tokenUrl" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "technicalUser" VARCHAR(80),
    "apiConfig" JSONB DEFAULT '{}'::jsonb,
    "scheduleFull" VARCHAR(80) DEFAULT 'Weekly · Sunday 01:00',
    "scheduleDelta" VARCHAR(80) DEFAULT 'Daily · 02:00',
    "status" VARCHAR(30) DEFAULT 'Connected',
    "statusMessage" TEXT,
    "lastFullSync" TIMESTAMPTZ,
    "lastDeltaSync" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Table: SyncStatus (Synchronization Audit & Health)
CREATE TABLE IF NOT EXISTS "SyncStatus" (
    "id" SERIAL PRIMARY KEY,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "completedAt" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL,
    "headersProcessed" INT DEFAULT 0,
    "authsProcessed" INT DEFAULT 0,
    "orgDataProcessed" INT DEFAULT 0,
    "tcodesProcessed" INT DEFAULT 0,
    "userAssignmentsProcessed" INT DEFAULT 0,
    "failedRecords" INT DEFAULT 0,
    "errorMessage" TEXT
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS "idx_role_headers_type" ON "RoleHeaders"("RoleType");
CREATE INDEX IF NOT EXISTS "idx_role_headers_change_dat" ON "RoleHeaders"("ChangeDat");
CREATE INDEX IF NOT EXISTS "idx_role_auths_object" ON "RoleAuthorizations"("Object");
CREATE INDEX IF NOT EXISTS "idx_role_auths_field" ON "RoleAuthorizations"("Field");
CREATE INDEX IF NOT EXISTS "idx_role_org_varbl" ON "RoleOrgData"("Varbl");
CREATE INDEX IF NOT EXISTS "idx_role_tcodes_report" ON "RoleTCodes"("Report");
CREATE INDEX IF NOT EXISTS "idx_role_user_assignments_uname" ON "RoleUserAssignments"("Uname");
CREATE INDEX IF NOT EXISTS "idx_role_user_assignments_agr" ON "RoleUserAssignments"("AgrName");
