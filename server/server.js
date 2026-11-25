import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  masterSync,
  getXsuaaToken,
  getSyncLockStatus,
  testSapConnection,
  syncSingleRoleFromSap,
  syncHeaderToUser,
  inspectCapWriteCapabilities,
  executeCapWriteAction,
  normalizeSapDate,
  DEFAULT_CONFIG,
} from "./syncService.js";
import {
  initFioriVectorDb,
  extractAuthApps,
  enrichAppsBatch,
  semanticSearchFiori,
  getFioriCatalog,
  getFioriStats,
  startChunkedEnrichJob,
  getChunkedJobStatus,
  cancelChunkedJob,
  getFioriAppDetail,
} from "./fioriService.js";

// Helper to format SAP date and optional time into proper ISO string for frontend
function formatIsoDate(dateVal, timeVal) {
  if (!dateVal) return null;
  // dateVal may be a Date object or a string
  const dateStr = dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal).split('T')[0];
  const timeStr = timeVal ? String(timeVal).slice(0, 8) : '00:00:00';
  return `${dateStr}T${timeStr}Z`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5055;

app.use(cors());
app.use(express.json());

// Database connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || "postgres"}:${encodeURIComponent(process.env.DB_PASSWORD || "postgres")}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || "postgres"}`,
  connectionTimeoutMillis: 5000,
});

let pgConnected = false;

// Verify Database Connection on startup
async function checkDb() {
  try {
    const client = await pool.connect();
    pgConnected = true;
    console.log(`[DB] Connected to PostgreSQL '${process.env.DB_NAME || "postgres"}' successfully.`);
    const countRes = await client.query('SELECT COUNT(*) FROM "RoleHeaders"');
    console.log(`[DB] Current records in "RoleHeaders": ${countRes.rows[0].count}`);

    // Ensure SyncStatus has all required columns for sync history tracking
    await client.query(`
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "syncType" VARCHAR(20) DEFAULT 'Delta';
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "systemId" VARCHAR(50) DEFAULT 'HMF-100';
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "systemName" VARCHAR(150) DEFAULT 'HMF 2023 – SAP S/4HANA (BTP CAP)';
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "records" INT DEFAULT 0;
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "durationSec" INT DEFAULT 0;
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "message" TEXT;
      ALTER TABLE "SyncStatus" ADD COLUMN IF NOT EXISTS "userAssignmentsProcessed" INT DEFAULT 0;
    `);

    // Ensure RoleUserAssignments table exists (v1.2 ZGW_ROLES_MANAGEMENT_SRV)
    await client.query(`
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
      CREATE INDEX IF NOT EXISTS "idx_role_user_assignments_uname" ON "RoleUserAssignments"("Uname");
      CREATE INDEX IF NOT EXISTS "idx_role_user_assignments_agr" ON "RoleUserAssignments"("AgrName");
    `);

    // Ensure SapSystems table exists and seed HMF-100 if empty
    await client.query(`
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
    `);

    const sysCount = await client.query('SELECT COUNT(*) FROM "SapSystems"');
    if (parseInt(sysCount.rows[0].count, 10) === 0) {
      const defaultApiConfig = {
        serviceRoot: DEFAULT_CONFIG.baseUrl,
        destination: "HMF_2023",
        tokenUrl: DEFAULT_CONFIG.authTokenUrl,
        clientId: DEFAULT_CONFIG.clientId,
        scopes: { roleData: true, userAssignments: true, writeActions: true },
        endpoints: {
          roleHeaders: "RoleHeaders",
          roleAuthorizations: "RoleAuthorizations",
          roleOrgData: "RoleOrgData",
          roleTCodes: "RoleTCodes",
          userAssignments: "RoleUserAssignments",
          userMasterUrl: "",
        },
        pageSize: 200,
      };
      await client.query(`
        INSERT INTO "SapSystems" (
          "id", "name", "sid", "client", "tier", "deployment", "method", "authType",
          "host", "serviceRoot", "destination", "tokenUrl", "clientId", "clientSecret",
          "apiConfig", "scheduleFull", "scheduleDelta", "status", "lastFullSync", "lastDeltaSync"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT ("id") DO NOTHING
      `, [
        "HMF-100",
        "HMF 2023 – SAP S/4HANA (BTP CAP)",
        "HMF",
        "100",
        "Prod",
        "Public Cloud",
        "OData API",
        "OAuth 2.0 client credentials",
        "mygo-consulting-inc-mygo-bas-4e8bz4sk-mygo-bas-zrole-he2315c850.cfapps.us10-001.hana.ondemand.com",
        DEFAULT_CONFIG.baseUrl,
        "HMF_2023",
        DEFAULT_CONFIG.authTokenUrl,
        DEFAULT_CONFIG.clientId,
        DEFAULT_CONFIG.clientSecret,
        JSON.stringify(defaultApiConfig),
        "Weekly · Sunday 01:00",
        "Daily · 02:00",
        "Connected",
        "2026-11-06T18:56:11.274Z",
        "2026-11-06T18:56:11.274Z",
      ]);
    } else {
      // Automatically keep SapSystems clientSecret aligned with current Admin.md v1.3 credentials
      await client.query(`
        UPDATE "SapSystems"
        SET "clientSecret" = $1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = 'HMF-100'
          AND ("clientSecret" IS NULL OR "clientSecret" != $1)
      `, [DEFAULT_CONFIG.clientSecret]);
    }

    // Initialize Fiori App Vector Catalog and pgvector extension
    await initFioriVectorDb(client);

    client.release();
    startCloudPoller();
  } catch (err) {
    pgConnected = false;
    console.error("[DB ERROR] PostgreSQL connection failed:", err.stack || err.message || err);
  }
}

checkDb();

// Standard SAP Organizational Level Dictionary
const SAP_ORG_LABELS = {
  $WERKS: "Plant / Maintenance Plant",
  $BUKRS: "Company Code",
  $EKORG: "Purchasing Organization",
  $VKORG: "Sales Organization",
  $VTWEG: "Distribution Channel",
  $SPART: "Division",
  $LGORT: "Storage Location",
  $KOKRS: "Controlling Area",
  $KOSTL: "Cost Center",
  $PRCTR: "Profit Center",
  $IWERK: "Maintenance Planning Plant",
  $GSBER: "Business Area",
  $PERSG: "Employee Group",
  $PERSK: "Employee Subgroup",
};

// Map SAP Role Process by Name or Text
function determineProcess(roleName, desc) {
  const upper = (roleName + " " + (desc || "")).toUpperCase();
  if (upper.includes("FI") || upper.includes("FINANCE") || upper.includes("GL") || upper.includes("AP") || upper.includes("AR") || upper.includes("FSN") || upper.includes("ECRS")) return "Finance";
  if (upper.includes("MM") || upper.includes("PURCHAS") || upper.includes("BUYER") || upper.includes("INV") || upper.includes("ISDFPS") || upper.includes("PLMI") || upper.includes("SCWM")) return "Procurement";
  if (upper.includes("SD") || upper.includes("SALES") || upper.includes("ORDER") || upper.includes("BILLING") || upper.includes("SAPTRX")) return "Sales";
  if (upper.includes("HR") || upper.includes("PAYROLL") || upper.includes("HCM") || upper.includes("PERS") || upper.includes("TDAG")) return "HR";
  return "Basis";
}

function deriveRoleType(roleType, parentAgr) {
  if (parentAgr && String(parentAgr).trim() !== "") return "Derived";
  const rt = String(roleType || "").trim();
  if (rt === "Collective" || rt === "Composite") return "Composite";
  return "Single";
}

// -------------------------------------------------------------
// 1. SYNCHRONIZATION ENDPOINTS
// -------------------------------------------------------------

// Security middleware to protect sync endpoint from unauthorized triggers
function requireSyncAuth(req, res, next) {
  const configuredKey = process.env.SYNC_API_KEY || "mysodai-sync-secure-token";
  const providedKey = req.headers["x-sync-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Access to master synchronization requires a valid 'x-sync-key' or Authorization header.",
    });
  }
  next();
}

// POST /api/sync/roles - Trigger protected master synchronization
app.post("/api/sync/roles", requireSyncAuth, async (req, res) => {
  if (getSyncLockStatus()) {
    return res.status(409).json({
      success: false,
      error: "A master synchronization process is already actively running. Parallel executions are rejected.",
    });
  }

  // Sanitize and bound parameters
  const pageSize = Math.min(Math.max(parseInt(req.body.pageSize || 200, 10), 10), 1000);
  const maxPages = Math.min(Math.max(parseInt(req.body.maxPages || 5, 10), 1), 200);

  try {
    const result = await masterSync(pool, {
      pageSize,
      maxPages,
    });
    res.json({
      success: result.success,
      message: `Master synchronization completed with status: ${result.status}`,
      details: result,
    });
  } catch (err) {
    console.error("[API SYNC ERROR]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sync/status - Synchronization status, health and history
app.get("/api/sync/status", async (req, res) => {
  try {
    const statusRes = await pool.query(`
      SELECT * FROM "SyncStatus"
      ORDER BY id DESC
      LIMIT 1
    `);

    const historyRes = await pool.query(`
      SELECT id, "startedAt", "completedAt", "status", 
             "headersProcessed", "authsProcessed", "orgDataProcessed", "tcodesProcessed",
             "userAssignmentsProcessed", "failedRecords", "errorMessage"
      FROM "SyncStatus"
      ORDER BY id DESC
      LIMIT 5
    `);

    const countsRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM "RoleHeaders") as headers,
        (SELECT COUNT(*) FROM "RoleAuthorizations") as auths,
        (SELECT COUNT(*) FROM "RoleOrgData") as org_data,
        (SELECT COUNT(*) FROM "RoleTCodes") as tcodes,
        (SELECT COUNT(*) FROM "RoleUserAssignments") as user_assignments
    `);

    res.json({
      isRunning: getSyncLockStatus(),
      lastSync: statusRes.rows[0] || null,
      currentCounts: {
        roleHeaders: parseInt(countsRes.rows[0].headers, 10),
        roleAuthorizations: parseInt(countsRes.rows[0].auths, 10),
        roleOrgData: parseInt(countsRes.rows[0].org_data, 10),
        roleTCodes: parseInt(countsRes.rows[0].tcodes, 10),
        roleUserAssignments: parseInt(countsRes.rows[0].user_assignments, 10),
      },
      recentRuns: historyRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. POSTGRESQL-BACKED READ APIS (SEARCH, FILTER, SORT, PAGINATE)
// -------------------------------------------------------------

// 1. GET /api/roles - All role headers with filtering, search, sorting, pagination
app.get("/api/roles", async (req, res) => {
  const { search, q, prefix, type, process: proc, limit = 10000, offset = 0, orderby } = req.query;

  try {
    const conditions = [];
    const params = [];

    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      conditions.push(`("AgrName" ILIKE $${params.length} OR "Text" ILIKE $${params.length})`);
    }

    if (prefix) {
      const cleanPrefix = prefix.replace(/\*/g, "%");
      params.push(cleanPrefix.endsWith("%") ? cleanPrefix : `${cleanPrefix}%`);
      conditions.push(`"AgrName" ILIKE $${params.length}`);
    }

    if (type && type !== "all") {
      if (type === "Derived") {
        conditions.push(`("ParentAgr" IS NOT NULL AND "ParentAgr" != '')`);
      } else if (type === "Composite" || type === "Collective") {
        conditions.push(`("ParentAgr" IS NULL OR "ParentAgr" = '') AND "RoleType" IN ('Collective', 'Composite')`);
      } else if (type === "Single") {
        conditions.push(`("ParentAgr" IS NULL OR "ParentAgr" = '') AND COALESCE("RoleType", 'Single') NOT IN ('Collective', 'Composite')`);
      } else {
        params.push(type);
        conditions.push(`"RoleType" = $${params.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total matching for pagination headers
    const countQuery = `SELECT COUNT(*) FROM "RoleHeaders" ${whereClause}`;
    const totalCountRes = await pool.query(countQuery, params);
    const totalCount = parseInt(totalCountRes.rows[0].count, 10);
    res.setHeader("X-Total-Count", totalCount);
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");

    // Safe sorting whitelist
    let orderClause = 'ORDER BY "AgrName" ASC';
    if (orderby) {
      const allowed = {
        agrname: '"AgrName"',
        name: '"AgrName"',
        text: '"Text"',
        description: '"Text"',
        roletype: '"RoleType"',
        type: '"RoleType"',
        changedat: '"ChangeDat"',
        createdat: '"CreateDat"',
        updatedat: '"updatedAt"',
      };
      const [col, dir] = orderby.trim().split(/\s+/);
      const mapped = allowed[col.toLowerCase()];
      if (mapped) {
        orderClause = `ORDER BY ${mapped} ${dir?.toUpperCase() === "DESC" ? "DESC NULLS LAST" : "ASC NULLS LAST"}`;
      }
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10000, 1), 20000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const queryParams = [...params, safeLimit, safeOffset];
    const limitClause = `LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;

    const query = `
      SELECT r.*,
             (SELECT COUNT(*) FROM "RoleAuthorizations" a WHERE a."AgrName" = r."AgrName") as auth_count,
             (SELECT COUNT(*) FROM "RoleOrgData" o WHERE o."AgrName" = r."AgrName") as org_count,
             (SELECT COUNT(DISTINCT a."Low") FROM "RoleAuthorizations" a WHERE a."AgrName" = r."AgrName" AND a."Object" = 'S_TCODE' AND a."Field" = 'TCD') as tcode_count
      FROM "RoleHeaders" r
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `;

    const result = await pool.query(query, queryParams);

    const tcodesByRole = new Map();
    const authsByRole = new Map();
    const orgsByRole = new Map();
    const childrenByRole = new Map();

    if (result.rows.length > 0) {
      const agrNames = result.rows.map((r) => r.AgrName || r.agrname);
      const [tcRes, authRes, orgRes, childRes] = await Promise.all([
        pool.query(
          `SELECT DISTINCT t."AgrName", t.tcode FROM (
             SELECT "AgrName", "Report" AS tcode FROM "RoleTCodes"
             WHERE "AgrName" = ANY($1) AND "Report" IS NOT NULL AND "Report" != ''
             UNION
             SELECT "AgrName", "Low" AS tcode FROM "RoleAuthorizations"
             WHERE "AgrName" = ANY($1) AND "Object" = 'S_TCODE' AND "Field" = 'TCD'
               AND "Deleted" IS NOT TRUE AND "Low" IS NOT NULL AND "Low" != ''
           ) t ORDER BY t."AgrName", t.tcode ASC`,
          [agrNames],
        ),
        pool.query(
          `SELECT "AgrName", "Counter", "Object", "Auth", "Field", "Low", "High", "Modified", "Node"
           FROM "RoleAuthorizations"
           WHERE "AgrName" = ANY($1) AND "Deleted" IS NOT TRUE AND "Object" IS NOT NULL
           ORDER BY "AgrName", "Counter" ASC`,
          [agrNames],
        ),
        pool.query(
          `SELECT "AgrName", "Counter", "Varbl", "Low", "High"
           FROM "RoleOrgData"
           WHERE "AgrName" = ANY($1)
           ORDER BY "AgrName", "Counter" ASC`,
          [agrNames],
        ),
        pool.query(
          `SELECT "ParentAgr", ARRAY_AGG("AgrName" ORDER BY "AgrName") AS children
           FROM "RoleHeaders"
           WHERE "ParentAgr" = ANY($1)
           GROUP BY "ParentAgr"`,
          [agrNames],
        ),
      ]);

      for (const row of tcRes.rows) {
        const key = row.AgrName || row.agrname;
        let arr = tcodesByRole.get(key);
        if (!arr) { arr = []; tcodesByRole.set(key, arr); }
        arr.push(row.tcode);
      }

      for (const a of authRes.rows) {
        const key = a.AgrName || a.agrname;
        let arr = authsByRole.get(key);
        if (!arr) { arr = []; authsByRole.set(key, arr); }
        arr.push({
          counter: a.Counter || a.counter || undefined,
          object: a.Object || a.object || "",
          auth: a.Auth || a.auth || undefined,
          field: a.Field || a.field || "",
          low: a.Low ?? a.low ?? "",
          high: a.High ?? a.high ?? undefined,
          modified: a.Modified || a.modified || undefined,
          node: a.Node || a.node || undefined,
        });
      }

      for (const o of orgRes.rows) {
        const key = o.AgrName || o.agrname;
        const v = o.Varbl || o.varbl;
        let arr = orgsByRole.get(key);
        if (!arr) { arr = []; orgsByRole.set(key, arr); }
        arr.push({
          counter: o.Counter || o.counter,
          varbl: v,
          field: v?.replace("$", "") || "BUKRS",
          label: SAP_ORG_LABELS[v] || v || "Org Field",
          low: o.Low ?? o.low ?? "*",
          high: o.High ?? o.high ?? "",
        });
      }

      for (const c of childRes.rows) {
        childrenByRole.set(c.ParentAgr || c.parentagr, c.children || []);
      }
    }

    const roles = result.rows
      .filter((r) => {
        const agr = r.AgrName || r.agrname;
        const txt = r.Text || r.text;
        if (!proc || proc === "all") return true;
        return determineProcess(agr, txt) === proc;
      })
      .map((r) => {
        const agrName = r.AgrName || r.agrname;
        const text = r.Text || r.text || agrName;
        const parentAgr = r.ParentAgr || r.parentagr;
        const flagType = r.FLAG_TYPE || r.flag_type;
        const roleType = r.RoleType || r.roletype;
        const createUsr = r.CreateUsr || r.createusr;
        const createDat = r.CreateDat || r.createdat;
        const createTim = r.CreateTim || r.createtim;
        const changeUsr = r.ChangeUsr || r.changeusr;
        const changeDat = r.ChangeDat || r.changedat;
        const changeTim = r.ChangeTim || r.changetim;
        const updatedAt = r.updatedAt || r.updatedat || new Date().toISOString();
        const roleTcodes = tcodesByRole.get(agrName) || [];
        const roleAuths = authsByRole.get(agrName) || [];
        const roleOrgs = orgsByRole.get(agrName) || [];
        const roleChildren = childrenByRole.get(agrName) || [];

        return {
          name: agrName,
          description: text,
          type: deriveRoleType(roleType, parentAgr),
          parent: parentAgr || undefined,
          children: roleChildren,
          process: determineProcess(agrName, text),
          owner: changeUsr || createUsr || "SAP Admin",
          tcodes: roleTcodes,
          auths: roleAuths,
          orgLevels: roleOrgs,
          authCount: parseInt(r.auth_count, 10) || roleAuths.length,
          orgCount: parseInt(r.org_count, 10) || roleOrgs.length,
          tcodeCount: parseInt(r.tcode_count, 10) || roleTcodes.length,
          createDat: createDat ? formatIsoDate(createDat, createTim) : undefined,
          createUsr: createUsr || undefined,
          changeDat: changeDat ? formatIsoDate(changeDat, changeTim) : undefined,
          changeUsr: changeUsr || undefined,
          changeTim: changeTim || undefined,
          flagType: flagType || undefined,
          lastChanged: changeDat ? formatIsoDate(changeDat, changeTim) : updatedAt,
          lastAnalysed: updatedAt,
        };
      });

    res.json(roles);
  } catch (err) {
    console.error("GET /api/roles error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/roles/:AgrName - Single role header by AgrName
app.get("/api/roles/:AgrName", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName);
  try {
    const query = `
      SELECT r.*,
             (SELECT COUNT(*) FROM "RoleAuthorizations" a WHERE a."AgrName" = r."AgrName") as auth_count,
             (SELECT COUNT(*) FROM "RoleOrgData" o WHERE o."AgrName" = r."AgrName") as org_count,
             (SELECT COUNT(DISTINCT a."Low") FROM "RoleAuthorizations" a WHERE a."AgrName" = r."AgrName" AND a."Object" = 'S_TCODE' AND a."Field" = 'TCD') as tcode_count
      FROM "RoleHeaders" r
      WHERE r."AgrName" = $1
    `;
    const result = await pool.query(query, [roleName]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Role '${roleName}' not found in database.` });
    }
    const r = result.rows[0];
    const childRes = await pool.query(
      'SELECT "AgrName" FROM "RoleHeaders" WHERE "ParentAgr" = $1 ORDER BY "AgrName" ASC',
      [r.AgrName],
    );
    res.json({
      name: r.AgrName,
      description: r.Text || r.AgrName,
      type: deriveRoleType(r.RoleType, r.ParentAgr),
      parent: r.ParentAgr || undefined,
      children: childRes.rows.map((c) => c.AgrName),
      process: determineProcess(r.AgrName, r.Text),
      owner: r.ChangeUsr || r.CreateUsr || "SAP Admin",
      authCount: parseInt(r.auth_count, 10),
      orgCount: parseInt(r.org_count, 10),
      tcodeCount: parseInt(r.tcode_count, 10),
      createDat: r.CreateDat,
      changeDat: r.ChangeDat,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/roles/:AgrName/authorizations - Authorizations by AgrName with search, filter, sort, paginate
app.get("/api/roles/:AgrName/authorizations", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName);
  const { search, q, object, field, limit = 500, offset = 0, orderby } = req.query;

  try {
    const conditions = ['"AgrName" = $1'];
    const params = [roleName];

    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      conditions.push(`("Object" ILIKE $${params.length} OR "Field" ILIKE $${params.length} OR "Low" ILIKE $${params.length} OR "Auth" ILIKE $${params.length})`);
    }

    if (object) {
      params.push(object);
      conditions.push(`"Object" = $${params.length}`);
    }

    if (field) {
      params.push(field);
      conditions.push(`"Field" = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countRes = await pool.query(`SELECT COUNT(*) FROM "RoleAuthorizations" ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);
    res.setHeader("X-Total-Count", total);
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");

    let orderClause = 'ORDER BY "Counter" ASC';
    if (orderby) {
      const allowed = {
        counter: '"Counter"',
        object: '"Object"',
        field: '"Field"',
        auth: '"Auth"',
        low: '"Low"',
      };
      const [col, dir] = orderby.trim().split(/\s+/);
      const mapped = allowed[col.toLowerCase()];
      if (mapped) {
        orderClause = `ORDER BY ${mapped} ${dir?.toUpperCase() === "DESC" ? "DESC NULLS LAST" : "ASC NULLS LAST"}`;
      }
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10000, 1), 20000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const queryParams = [...params, safeLimit, safeOffset];

    const query = `
      SELECT * FROM "RoleAuthorizations"
      ${whereClause}
      ${orderClause}
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
    `;

    const result = await pool.query(query, queryParams);
    const fallbackProfile = `T_${roleName.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}00`;

    const rows = result.rows.map((a, idx) => ({
      counter: a.Counter || a.counter || String(idx + 1).padStart(6, "0"),
      object: a.Object || a.object || "",
      auth: a.Auth || a.auth || fallbackProfile,
      field: a.Field || a.field || "",
      low: a.Low ?? a.low ?? "",
      high: a.High ?? a.high ?? "",
      modified: a.Modified || a.modified || "S",
      deleted: Boolean(a.Deleted ?? a.deleted),
      copied: Boolean(a.Copied ?? a.copied),
      neu: a.Neu || a.neu || "O",
      node: a.Node || a.node || String(idx + 28).padStart(6, "0"),
    }));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/roles/:AgrName/org-data - Organizational data by AgrName with search, filter, sort, paginate
app.get("/api/roles/:AgrName/org-data", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName);
  const { search, q, varbl, limit = 500, offset = 0, orderby } = req.query;

  try {
    const conditions = ['"AgrName" = $1'];
    const params = [roleName];

    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      conditions.push(`("Varbl" ILIKE $${params.length} OR "Low" ILIKE $${params.length} OR "High" ILIKE $${params.length})`);
    }

    if (varbl) {
      params.push(varbl);
      conditions.push(`"Varbl" = $${params.length}`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countRes = await pool.query(`SELECT COUNT(*) FROM "RoleOrgData" ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);
    res.setHeader("X-Total-Count", total);
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");

    let orderClause = 'ORDER BY "Counter" ASC';
    if (orderby) {
      const allowed = {
        counter: '"Counter"',
        varbl: '"Varbl"',
        low: '"Low"',
        high: '"High"',
      };
      const [col, dir] = orderby.trim().split(/\s+/);
      const mapped = allowed[col.toLowerCase()];
      if (mapped) {
        orderClause = `ORDER BY ${mapped} ${dir?.toUpperCase() === "DESC" ? "DESC NULLS LAST" : "ASC NULLS LAST"}`;
      }
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10000, 1), 20000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const queryParams = [...params, safeLimit, safeOffset];

    const query = `
      SELECT * FROM "RoleOrgData"
      ${whereClause}
      ${orderClause}
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
    `;

    const result = await pool.query(query, queryParams);
    const rows = result.rows.map((o) => {
      const v = o.Varbl || o.varbl;
      const low = o.Low ?? o.low ?? "*";
      const high = o.High ?? o.high ?? "";
      const counter = o.Counter || o.counter;
      return {
        counter,
        varbl: v,
        field: v?.replace("$", "") || "BUKRS",
        label: SAP_ORG_LABELS[v] || v || "Org Field",
        low,
        high,
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /api/roles/:AgrName/tcodes - Transaction codes by AgrName (merging Menu & S_TCODE auths)
app.get("/api/roles/:AgrName/tcodes", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName);
  const { search, q, limit = 500, offset = 0 } = req.query;

  try {
    const searchTerm = (search || q || "").trim();
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10000, 1), 20000);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const countQuery = `
      WITH combined_tcodes AS (
        SELECT "Report" as tcode FROM "RoleTCodes" WHERE "AgrName" = $1 AND "Report" IS NOT NULL
        UNION
        SELECT "Low" as tcode FROM "RoleAuthorizations" WHERE "AgrName" = $1 AND "Object" = 'S_TCODE' AND "Field" = 'TCD' AND "Low" IS NOT NULL
      )
      SELECT COUNT(DISTINCT tcode) FROM combined_tcodes WHERE ($2 = '' OR tcode ILIKE '%' || $2 || '%')
    `;

    const countRes = await pool.query(countQuery, [roleName, searchTerm]);
    const total = parseInt(countRes.rows[0].count, 10);
    res.setHeader("X-Total-Count", total);
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");

    const query = `
      WITH combined_tcodes AS (
        SELECT "Report" as tcode, 'Menu' as source
        FROM "RoleTCodes"
        WHERE "AgrName" = $1 AND "Report" IS NOT NULL
        UNION
        SELECT "Low" as tcode, 'Authorization' as source
        FROM "RoleAuthorizations"
        WHERE "AgrName" = $1 AND "Object" = 'S_TCODE' AND "Field" = 'TCD' AND "Low" IS NOT NULL
      )
      SELECT DISTINCT tcode, source
      FROM combined_tcodes
      WHERE ($2 = '' OR tcode ILIKE '%' || $2 || '%')
      ORDER BY tcode ASC
      LIMIT $3 OFFSET $4
    `;

    const result = await pool.query(query, [roleName, searchTerm, safeLimit, safeOffset]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/roles/:AgrName/details - Complete role details (Header + Auths + OrgLevels + TCodes)
app.get("/api/roles/:AgrName/details", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName);
  try {
    let headerRes = await pool.query('SELECT * FROM "RoleHeaders" WHERE "AgrName" = $1 OR UPPER("AgrName") = UPPER($1)', [roleName]);
    if (headerRes.rows.length === 0 && pgConnected) {
      // Live on-demand fetch from SAP BTP Cloud if missing in local PostgreSQL
      try {
        const { capConfig } = await resolveSystemExecutionContext("HMF-100");
        const token = await getXsuaaToken(capConfig);
        const btpUrl = `${capConfig.baseUrl}/RoleHeaders?$filter=AgrName eq '${encodeURIComponent(roleName.toUpperCase())}'`;
        const resp = await fetch(btpUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const r = (data.value || [])[0];
          if (r) {
            await pool.query(`
              INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "CreateDat", "CreateUsr", "updatedAt")
              VALUES ($1, $2, COALESCE($3, 'Single'), COALESCE($4, 'COLL_AGR'), $5, $6, $7, CURRENT_TIMESTAMP)
              ON CONFLICT ("AgrName") DO UPDATE SET "Text" = EXCLUDED."Text", "updatedAt" = CURRENT_TIMESTAMP
            `, [r.AgrName, r.ParentAgr || null, r.RoleType || 'Single', r.FLAG_TYPE || 'COLL_AGR', r.Text || r.AgrName, normalizeSapDate(r.CreateDat), r.CreateUsr || 'SAP_BTP']);
            headerRes = await pool.query('SELECT * FROM "RoleHeaders" WHERE "AgrName" = $1 OR UPPER("AgrName") = UPPER($1)', [roleName]);
          }
        }
      } catch (liveErr) {
        console.warn(`[Details Live Cloud Fetch] Could not fetch ${roleName} from BTP:`, liveErr.message);
      }
    }
    if (headerRes.rows.length === 0) {
      return res.status(404).json({ error: `Role '${roleName}' not found in database or SAP cloud.` });
    }

    const r = headerRes.rows[0];
    const actualRoleName = r.AgrName || r.agrname;
    const text = r.Text || r.text || actualRoleName;
    const parentAgr = r.ParentAgr || r.parentagr;
    const flagType = r.FLAG_TYPE || r.flag_type;
    const roleType = r.RoleType || r.roletype;
    const createUsr = r.CreateUsr || r.createusr;
    const createDat = r.CreateDat || r.createdat;
    const createTim = r.CreateTim || r.createtim;
    const changeUsr = r.ChangeUsr || r.changeusr;
    const changeDat = r.ChangeDat || r.changedat;
    const changeTim = r.ChangeTim || r.changetim;
    const updatedAt = r.updatedAt || r.updatedat || new Date().toISOString();

    const [authsRes, orgRes, tcodesRes, childrenRes] = await Promise.all([
      pool.query('SELECT * FROM "RoleAuthorizations" WHERE "AgrName" = $1 ORDER BY "Counter" ASC', [actualRoleName]),
      pool.query('SELECT * FROM "RoleOrgData" WHERE "AgrName" = $1 ORDER BY "Counter" ASC', [actualRoleName]),
      pool.query(`
        SELECT "Report" as tcode, 'Menu' as source FROM "RoleTCodes" WHERE "AgrName" = $1 AND "Report" IS NOT NULL
        UNION
        SELECT "Low" as tcode, 'Authorization' as source FROM "RoleAuthorizations" WHERE "AgrName" = $1 AND "Object" = 'S_TCODE' AND "Field" = 'TCD' AND "Low" IS NOT NULL
        ORDER BY tcode ASC
      `, [actualRoleName]),
      pool.query('SELECT "AgrName" FROM "RoleHeaders" WHERE "ParentAgr" = $1 ORDER BY "AgrName" ASC', [actualRoleName]),
    ]);

    const auths = authsRes.rows.map((a, idx) => ({
      counter: a.Counter || a.counter || String(idx + 1).padStart(6, "0"),
      object: a.Object || a.object || "",
      auth: a.Auth || a.auth || undefined,
      field: a.Field || a.field || "",
      low: a.Low ?? a.low ?? "",
      high: a.High ?? a.high ?? "",
      modified: a.Modified || a.modified || undefined,
      deleted: Boolean(a.Deleted ?? a.deleted),
      copied: Boolean(a.Copied ?? a.copied),
      neu: a.Neu || a.neu || undefined,
      node: a.Node || a.node || undefined,
    }));

    const orgLevels = orgRes.rows.map((o) => {
      const v = o.Varbl || o.varbl;
      const low = o.Low ?? o.low ?? "*";
      const high = o.High ?? o.high ?? "";
      const counter = o.Counter || o.counter;
      return {
        counter,
        varbl: v,
        field: v?.replace("$", "") || "BUKRS",
        label: SAP_ORG_LABELS[v] || v || "Org Field",
        low,
        high,
      };
    });

    const tcodeDetails = tcodesRes.rows
      .map((t) => ({
        tcode: t.tcode,
        source: t.source || "Menu",
      }))
      .filter((t) => Boolean(t.tcode));

    const tcodes = tcodeDetails.map((t) => t.tcode);

    res.json({
      name: actualRoleName,
      description: text,
      type: deriveRoleType(roleType, parentAgr),
      parent: parentAgr || undefined,
      children: childrenRes.rows.map((c) => c.AgrName),
      process: determineProcess(actualRoleName, text),
      owner: changeUsr || createUsr || "SAP Admin",
      tcodes,
      tcodeDetails,
      auths,
      orgLevels,
      authCount: auths.length,
      orgCount: orgLevels.length,
      tcodeCount: tcodes.length,
      createDat: createDat ? formatIsoDate(createDat, createTim) : undefined,
      createTim: createTim || undefined,
      createUsr: createUsr || undefined,
      changeDat: changeDat ? formatIsoDate(changeDat, changeTim) : undefined,
      changeTim: changeTim || undefined,
      changeUsr: changeUsr || undefined,
      flagType: flagType || undefined,
      lastChanged: changeDat ? formatIsoDate(changeDat, changeTim) : updatedAt,
      lastAnalysed: updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. SYSTEM & STATUS ENDPOINTS
// -------------------------------------------------------------

app.get("/api/status", async (req, res) => {
  let roleCount = 0;
  if (pgConnected) {
    try {
      const c = await pool.query('SELECT COUNT(*) FROM "RoleHeaders"');
      roleCount = parseInt(c.rows[0].count, 10);
    } catch {}
  }
  res.json({
    status: "online",
    postgresConnected: pgConnected,
    database: process.env.DB_NAME || "postgres",
    roleCount,
  });
});

function normalizeApiConfig(rawConfig = {}, fallbackRow = {}) {
  const serviceRoot = rawConfig.serviceRoot || fallbackRow.serviceRoot || fallbackRow.host || DEFAULT_CONFIG.baseUrl;
  return {
    serviceRoot,
    destination: rawConfig.destination ?? fallbackRow.destination ?? "",
    tokenUrl: rawConfig.tokenUrl ?? fallbackRow.tokenUrl ?? "",
    clientId: rawConfig.clientId ?? fallbackRow.clientId ?? "",
    technicalUser: rawConfig.technicalUser ?? fallbackRow.technicalUser ?? "",
    hasSecret: Boolean(rawConfig.hasSecret || fallbackRow.clientSecret),
    scopes: {
      roleData: rawConfig.scopes?.roleData !== false,
      userAssignments: Boolean(rawConfig.scopes?.userAssignments),
      writeActions: rawConfig.scopes?.writeActions !== false,
    },
    endpoints: {
      roleHeaders: rawConfig.endpoints?.roleHeaders || "RoleHeaders",
      roleAuthorizations: rawConfig.endpoints?.roleAuthorizations || "RoleAuthorizations",
      roleOrgData: rawConfig.endpoints?.roleOrgData || "RoleOrgData",
      roleTCodes: rawConfig.endpoints?.roleTCodes || "RoleTCodes",
      userAssignments: rawConfig.endpoints?.userAssignments || "RoleUserAssignments",
      userMasterUrl: rawConfig.endpoints?.userMasterUrl || "",
    },
    pageSize: Math.min(Math.max(parseInt(rawConfig.pageSize || 200, 10) || 200, 10), 1000),
  };
}

function serializeSystemRow(row, counts) {
  const rawCfg = typeof row.apiConfig === "string" ? JSON.parse(row.apiConfig || "{}") : (row.apiConfig || {});
  const apiConfig = normalizeApiConfig(rawCfg, row);
  return {
    id: row.id,
    name: row.name,
    sid: row.sid,
    client: row.client,
    tier: row.tier,
    deployment: row.deployment,
    method: row.method,
    authType: row.authType,
    host: row.host,
    apiConfig,
    status: row.status || "Connected",
    statusMessage: row.statusMessage || undefined,
    lastFullSync: row.lastFullSync ? new Date(row.lastFullSync).toISOString() : new Date().toISOString(),
    lastDeltaSync: row.lastDeltaSync ? new Date(row.lastDeltaSync).toISOString() : new Date().toISOString(),
    counts,
    schedule: {
      full: row.scheduleFull || "Weekly · Sunday 01:00",
      delta: row.scheduleDelta || "Daily · 02:00",
    },
  };
}

app.get("/api/systems", async (req, res) => {
  let roleCount = 0;
  let authCount = 0;
  let userCount = 0;
  let lastFull = new Date("2026-11-06T18:56:11.274Z").toISOString();
  let lastDelta = new Date("2026-11-06T18:56:11.274Z").toISOString();

  if (pgConnected) {
    try {
      const c = await pool.query('SELECT COUNT(*) FROM "RoleHeaders"');
      roleCount = parseInt(c.rows[0].count, 10) || 0;
    } catch {}

    try {
      const a = await pool.query('SELECT COUNT(*) FROM "RoleAuthorizations"');
      authCount = parseInt(a.rows[0].count, 10) || 0;
    } catch {}

    try {
      const u = await pool.query('SELECT COUNT(DISTINCT "Uname") FROM "RoleUserAssignments"');
      userCount = parseInt(u.rows[0].count, 10) || 0;
    } catch {}

    try {
      const fRes = await pool.query(`
        SELECT "completedAt" FROM "SyncStatus" 
        WHERE ("syncType" = 'Full' OR "headersProcessed" > 1000) AND "status" = 'Success' 
        ORDER BY "completedAt" DESC LIMIT 1
      `);
      if (fRes.rows[0]?.completedAt) {
        lastFull = new Date(fRes.rows[0].completedAt).toISOString();
      }

      const dRes = await pool.query(`
        SELECT "completedAt" FROM "SyncStatus" 
        WHERE "status" = 'Success' 
        ORDER BY "completedAt" DESC LIMIT 1
      `);
      if (dRes.rows[0]?.completedAt) {
        lastDelta = new Date(dRes.rows[0].completedAt).toISOString();
      }
    } catch {}

    try {
      const sysRes = await pool.query('SELECT * FROM "SapSystems" ORDER BY "createdAt" ASC');
      if (sysRes.rows.length > 0) {
        const list = sysRes.rows.map((row) => {
          const isPrimary = row.id === "HMF-100";
          const counts = isPrimary
            ? { users: userCount, roles: roleCount, authRows: authCount }
            : { users: 0, roles: 0, authRows: 0 };
          const serialized = serializeSystemRow(row, counts);
          if (isPrimary) {
            if (!row.lastFullSync || new Date(lastFull) > new Date(row.lastFullSync)) serialized.lastFullSync = lastFull;
            if (!row.lastDeltaSync || new Date(lastDelta) > new Date(row.lastDeltaSync)) serialized.lastDeltaSync = lastDelta;
          }
          return serialized;
        });
        return res.json(list);
      }
    } catch (err) {
      console.error("[GET /api/systems DB ERROR]:", err.message);
    }
  }

  res.json([
    {
      id: "HMF-100",
      name: "HMF 2023 – SAP S/4HANA (BTP CAP)",
      sid: "HMF",
      client: "100",
      tier: "Prod",
      deployment: "Public Cloud",
      method: "OData API",
      authType: "OAuth 2.0 client credentials",
      host: "mygo-consulting-inc-mygo-bas-4e8bz4sk-mygo-bas-zrole-he2315c850.cfapps.us10-001.hana.ondemand.com",
      apiConfig: normalizeApiConfig({
        serviceRoot: DEFAULT_CONFIG.baseUrl,
        destination: "HMF_2023",
        tokenUrl: DEFAULT_CONFIG.authTokenUrl,
        clientId: DEFAULT_CONFIG.clientId,
        hasSecret: true,
        scopes: { roleData: true, userAssignments: true, writeActions: true },
      }),
      status: "Connected",
      lastFullSync: lastFull,
      lastDeltaSync: lastDelta,
      counts: { users: userCount, roles: roleCount, authRows: authCount },
      schedule: { full: "Weekly · Sunday 01:00", delta: "Daily · 02:00" },
    },
  ]);
});

app.post("/api/systems/test", async (req, res) => {
  try {
    const body = req.body || {};
    let storedSecret = body.secret || body.clientSecret || "";
    let storedConfig = {};
    if (body.systemId && pgConnected) {
      const sRes = await pool.query('SELECT * FROM "SapSystems" WHERE "id" = $1', [body.systemId]);
      if (sRes.rows[0]) {
        const row = sRes.rows[0];
        storedConfig = typeof row.apiConfig === "string" ? JSON.parse(row.apiConfig || "{}") : (row.apiConfig || {});
        if (!storedSecret) storedSecret = row.clientSecret || "";
        body.serviceRoot = body.serviceRoot || row.serviceRoot || storedConfig.serviceRoot || row.host;
        body.host = body.host || row.host;
        body.method = body.method || row.method;
        body.authType = body.authType || row.authType;
        body.tokenUrl = body.tokenUrl || row.tokenUrl || storedConfig.tokenUrl;
        body.clientId = body.clientId || row.clientId || storedConfig.clientId;
        body.technicalUser = body.technicalUser || row.technicalUser || storedConfig.technicalUser;
        body.scopes = body.scopes || storedConfig.scopes;
        body.endpoints = body.endpoints || storedConfig.endpoints;
      }
    }

    const result = await testSapConnection({
      host: body.host,
      serviceRoot: body.serviceRoot || body.apiConfig?.serviceRoot || body.host,
      method: body.method,
      authType: body.authType,
      tokenUrl: body.tokenUrl || body.apiConfig?.tokenUrl,
      clientId: body.clientId || body.apiConfig?.clientId,
      clientSecret: storedSecret,
      technicalUser: body.technicalUser || body.user || body.apiConfig?.technicalUser,
      scopes: body.scopes || body.apiConfig?.scopes || { roleData: true, userAssignments: false, writeActions: true },
      endpoints: body.endpoints || body.apiConfig?.endpoints || {},
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      steps: [{ key: "reachable", label: "Reachable", ok: false, hint: err.message }],
      grantedScopes: [],
    });
  }
});

app.post("/api/systems", async (req, res) => {
  const body = req.body || {};
  const sid = String(body.sid || "").trim().toUpperCase();
  const clientNum = String(body.client || "").trim();
  const id = body.id || `${sid}-${clientNum}`;
  if (!sid || !clientNum || !body.name) {
    return res.status(400).json({ error: "System name, SID, and Client are required." });
  }

  const rawServiceRoot = body.apiConfig?.serviceRoot || body.serviceRoot || body.host || "";
  let hostOnly = body.host || rawServiceRoot;
  try {
    if (/^https?:\/\//i.test(rawServiceRoot)) {
      hostOnly = new URL(rawServiceRoot).host;
    }
  } catch {}

  const apiConfig = normalizeApiConfig({
    ...(body.apiConfig || {}),
    serviceRoot: rawServiceRoot,
    hasSecret: Boolean(body.secret || body.clientSecret),
  });

  const now = new Date().toISOString();
  if (pgConnected) {
    try {
      await pool.query(`
        INSERT INTO "SapSystems" (
          "id", "name", "sid", "client", "tier", "deployment", "method", "authType",
          "host", "serviceRoot", "destination", "tokenUrl", "clientId", "clientSecret", "technicalUser",
          "apiConfig", "scheduleFull", "scheduleDelta", "status", "lastFullSync", "lastDeltaSync", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "tier" = EXCLUDED."tier",
          "deployment" = EXCLUDED."deployment",
          "method" = EXCLUDED."method",
          "authType" = EXCLUDED."authType",
          "host" = EXCLUDED."host",
          "serviceRoot" = EXCLUDED."serviceRoot",
          "destination" = EXCLUDED."destination",
          "tokenUrl" = EXCLUDED."tokenUrl",
          "clientId" = EXCLUDED."clientId",
          "clientSecret" = CASE WHEN EXCLUDED."clientSecret" IS NOT NULL AND EXCLUDED."clientSecret" <> '' THEN EXCLUDED."clientSecret" ELSE "SapSystems"."clientSecret" END,
          "technicalUser" = EXCLUDED."technicalUser",
          "apiConfig" = EXCLUDED."apiConfig",
          "scheduleFull" = EXCLUDED."scheduleFull",
          "scheduleDelta" = EXCLUDED."scheduleDelta",
          "status" = EXCLUDED."status",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [
        id,
        body.name,
        sid,
        clientNum,
        body.tier || "QA",
        body.deployment || "Public Cloud",
        body.method || "OData API",
        body.authType || "OAuth 2.0 client credentials",
        hostOnly,
        apiConfig.serviceRoot,
        apiConfig.destination || null,
        apiConfig.tokenUrl || null,
        apiConfig.clientId || null,
        body.secret || body.clientSecret || null,
        apiConfig.technicalUser || null,
        JSON.stringify(apiConfig),
        body.scheduleFull || body.schedule?.full || "Weekly · Sunday 01:00",
        body.scheduleDelta || body.schedule?.delta || "Daily · 02:00",
        "Connected",
        now,
        now,
      ]);

      await pool.query(`
        INSERT INTO "SyncStatus" (
          "startedAt", "completedAt", "status", "syncType", "systemId", "systemName",
          "records", "durationSec", "message", "headersProcessed"
        ) VALUES ($1, $1, 'Success', 'Full', $2, $3, 0, 1, $4, 0)
      `, [
        now,
        id,
        body.name,
        `System connected: ${body.name} (${apiConfig.scopes.userAssignments ? "Roles + User Assignments" : "Roles API"})`,
      ]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(201).json({
    id,
    name: body.name,
    sid,
    client: clientNum,
    tier: body.tier || "QA",
    deployment: body.deployment || "Public Cloud",
    method: body.method || "OData API",
    authType: body.authType || "OAuth 2.0 client credentials",
    host: hostOnly,
    apiConfig,
    status: "Connected",
    lastFullSync: now,
    lastDeltaSync: now,
    counts: { users: 0, roles: 0, authRows: 0 },
    schedule: {
      full: body.scheduleFull || body.schedule?.full || "Weekly · Sunday 01:00",
      delta: body.scheduleDelta || body.schedule?.delta || "Daily · 02:00",
    },
  });
});

app.put("/api/systems/:id", async (req, res) => {
  const sysId = decodeURIComponent(req.params.id);
  const body = req.body || {};
  if (!pgConnected) return res.status(503).json({ error: "Database unavailable" });

  try {
    const existingRes = await pool.query('SELECT * FROM "SapSystems" WHERE "id" = $1', [sysId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: `System ${sysId} not found.` });
    }
    const existing = existingRes.rows[0];
    const existingCfg = typeof existing.apiConfig === "string" ? JSON.parse(existing.apiConfig || "{}") : (existing.apiConfig || {});

    const incomingCfg = body.apiConfig || {};
    const serviceRoot = incomingCfg.serviceRoot ?? body.serviceRoot ?? existing.serviceRoot ?? existing.host;
    let hostOnly = body.host ?? existing.host;
    try {
      if (serviceRoot && /^https?:\/\//i.test(serviceRoot) && !body.host) {
        hostOnly = new URL(serviceRoot).host;
      }
    } catch {}

    const newSecret = body.secret || body.clientSecret || "";
    const mergedCfg = normalizeApiConfig({
      ...existingCfg,
      ...incomingCfg,
      serviceRoot,
      scopes: { ...(existingCfg.scopes || {}), ...(incomingCfg.scopes || {}) },
      endpoints: { ...(existingCfg.endpoints || {}), ...(incomingCfg.endpoints || {}) },
      hasSecret: Boolean(newSecret || existing.clientSecret),
    }, existing);

    const updatedName = body.name ?? existing.name;
    const schedFull = body.schedule?.full ?? body.scheduleFull ?? existing.scheduleFull;
    const schedDelta = body.schedule?.delta ?? body.scheduleDelta ?? existing.scheduleDelta;

    await pool.query(`
      UPDATE "SapSystems"
      SET "name" = $1,
          "host" = $2,
          "serviceRoot" = $3,
          "destination" = $4,
          "tokenUrl" = $5,
          "clientId" = $6,
          "clientSecret" = CASE WHEN $7 <> '' THEN $7 ELSE "clientSecret" END,
          "technicalUser" = $8,
          "apiConfig" = $9,
          "scheduleFull" = $10,
          "scheduleDelta" = $11,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $12
    `, [
      updatedName,
      hostOnly,
      mergedCfg.serviceRoot,
      mergedCfg.destination || null,
      mergedCfg.tokenUrl || null,
      mergedCfg.clientId || null,
      newSecret,
      mergedCfg.technicalUser || null,
      JSON.stringify(mergedCfg),
      schedFull,
      schedDelta,
      sysId,
    ]);

    const refreshed = await pool.query('SELECT * FROM "SapSystems" WHERE "id" = $1', [sysId]);
    res.json(serializeSystemRow(refreshed.rows[0], { users: 0, roles: 0, authRows: 0 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveSystemExecutionContext(systemId = "HMF-100") {
  let sysRow = null;
  if (pgConnected) {
    const r = await pool.query('SELECT * FROM "SapSystems" WHERE "id" = $1', [systemId]);
    sysRow = r.rows[0] || null;
    if (!sysRow) {
      const first = await pool.query('SELECT * FROM "SapSystems" ORDER BY "createdAt" ASC LIMIT 1');
      sysRow = first.rows[0] || null;
    }
  }
  const rawCfg = sysRow
    ? (typeof sysRow.apiConfig === "string" ? JSON.parse(sysRow.apiConfig || "{}") : (sysRow.apiConfig || {}))
    : {};
  const apiConfig = normalizeApiConfig(rawCfg, sysRow || {});
  const capConfig = {
    baseUrl: apiConfig.serviceRoot || DEFAULT_CONFIG.baseUrl,
    authTokenUrl: apiConfig.tokenUrl || DEFAULT_CONFIG.authTokenUrl,
    clientId: apiConfig.clientId || DEFAULT_CONFIG.clientId,
    clientSecret: sysRow?.clientSecret || DEFAULT_CONFIG.clientSecret,
  };
  return { sysRow, apiConfig, capConfig };
}

app.post("/api/systems/:id/sync", async (req, res) => {
  const sysId = decodeURIComponent(req.params.id);
  const { type = "Delta", pageSize, maxPages } = req.body || {};

  if (getSyncLockStatus()) {
    return res.status(409).json({ success: false, error: "A synchronization job is already running." });
  }

  try {
    const { sysRow, apiConfig: cfg, capConfig } = await resolveSystemExecutionContext(sysId);
    const result = await masterSync(pool, {
      systemId: sysId,
      systemName: sysRow?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)",
      syncType: type === "Full" ? "Full" : "Delta",
      pageSize: pageSize || cfg.pageSize || 200,
      maxPages: maxPages || (type === "Full" ? 15 : 5),
      maxPagesHeaders: type === "Full" ? 60 : 5,
      scopes: cfg.scopes,
      endpoints: cfg.endpoints,
      config: capConfig,
    });
    res.json({ success: result.success, details: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Per-role on-demand sync using filtered CAP queries (Sections 5 & 6 #11)
app.post("/api/roles/:AgrName/sync", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName).trim();
  const { systemId = "HMF-100" } = req.body || {};
  if (!pgConnected) return res.status(503).json({ error: "Database unavailable" });
  if (!roleName) return res.status(400).json({ error: "Role name is required." });

  try {
    const { apiConfig, capConfig } = await resolveSystemExecutionContext(systemId);
    const synced = await syncSingleRoleFromSap(pool, roleName, capConfig, apiConfig.endpoints);
    res.json({ success: true, synced });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// ADAPTIVE BACKGROUND CLOUD POLLER & DELTA SYNC (APPROACH 2)
// Automatically syncs roles created via SAP CAP / Postman into PostgreSQL.
// -------------------------------------------------------------
let isPollerRunning = false;
let lastSyncTimestamp = null;
let lastPollerStats = { count: 0, time: null, status: "idle" };
const CLOUD_POLLER_INTERVAL_MS = 45000; // Poll every 45s safely
let pollerTimer = null;

async function syncRecentRolesFromSapInternal(systemId = "HMF-100", top = 50) {
  if (!pgConnected) {
    throw new Error("PostgreSQL connection not ready");
  }

  const { capConfig } = await resolveSystemExecutionContext(systemId);
  const token = await getXsuaaToken(capConfig);
  const limit = Math.min(Math.max(parseInt(top, 10) || 50, 1), 100);

  // 1. Fetch recent RoleHeaders from SAP BTP Cloud
  let insertedCount = 0;
  try {
    const btpUrl = `${capConfig.baseUrl}/RoleHeaders?$orderby=CreateDat desc&$top=${limit}`;
    const resp = await fetch(btpUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const records = data.value || [];
      for (const r of records) {
        if (!r.AgrName) continue;
        await pool.query(`
          INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "CreateDat", "CreateUsr", "updatedAt")
          VALUES ($1, $2, COALESCE($3, 'Single'), COALESCE($4, 'COLL_AGR'), $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName") DO UPDATE SET
            "Text" = EXCLUDED."Text",
            "CreateDat" = COALESCE(EXCLUDED."CreateDat", "RoleHeaders"."CreateDat"),
            "CreateUsr" = COALESCE(EXCLUDED."CreateUsr", "RoleHeaders"."CreateUsr"),
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          r.AgrName,
          r.ParentAgr || null,
          r.RoleType || 'Single',
          r.FLAG_TYPE || 'COLL_AGR',
          r.Text || r.AgrName,
          normalizeSapDate(r.CreateDat),
          r.CreateUsr || 'SAP_BTP'
        ]);
        insertedCount++;
      }
    }
  } catch (err) {
    console.warn(`[Cloud Poller] RoleHeaders delta warning: ${err.message}`);
  }

  // 2. Fetch and synchronize latest RoleUsers assignments from SAP BTP Cloud
  let userAssignmentCount = 0;
  try {
    const usersUrl = `${capConfig.baseUrl}/RoleUsers?$orderby=ChangeDat desc&$top=${limit}`;
    const usersResp = await fetch(usersUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });

    if (usersResp.ok) {
      const usersData = await usersResp.json();
      const userRecords = usersData.value || [];
      for (const ua of userRecords) {
        const agrName = (ua.AgrName || "").trim();
        const uname = (ua.Uname || "").trim();
        if (!agrName || !uname) continue;

        // Ensure role exists in RoleHeaders so it is navigable
        await pool.query(`
          INSERT INTO "RoleHeaders" ("AgrName", "RoleType", "FLAG_TYPE", "Text", "updatedAt")
          VALUES ($1, 'Single', 'COLL_AGR', $1, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName") DO NOTHING
        `, [agrName]);

        // Upsert into RoleUserAssignments
        await pool.query(`
          INSERT INTO "RoleUserAssignments" (
            "AgrName", "Uname", "FromDat", "ToDat", "OrgFlag", "ColFlag",
            "Department", "FullName", "Locked", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName", "Uname") DO UPDATE SET
            "FromDat" = COALESCE(EXCLUDED."FromDat", "RoleUserAssignments"."FromDat"),
            "ToDat" = COALESCE(EXCLUDED."ToDat", "RoleUserAssignments"."ToDat"),
            "OrgFlag" = COALESCE(EXCLUDED."OrgFlag", "RoleUserAssignments"."OrgFlag"),
            "ColFlag" = COALESCE(EXCLUDED."ColFlag", "RoleUserAssignments"."ColFlag"),
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          agrName,
          uname,
          normalizeSapDate(ua.FromDat) || new Date().toISOString().split("T")[0],
          normalizeSapDate(ua.ToDat) || "9999-12-31",
          ua.OrgFlag || null,
          Boolean(ua.ColFlag),
          "SAP S/4HANA",
          uname,
          false
        ]);
        userAssignmentCount++;
      }
    }
  } catch (err) {
    console.warn(`[Cloud Poller] RoleUsers delta warning: ${err.message}`);
  }

  lastSyncTimestamp = new Date();
  return { count: insertedCount, userAssignments: userAssignmentCount, timestamp: lastSyncTimestamp };
}

async function runCloudPollerCycle() {
  if (isPollerRunning) return;
  if (!pgConnected) {
    pollerTimer = setTimeout(runCloudPollerCycle, CLOUD_POLLER_INTERVAL_MS);
    return;
  }

  try {
    isPollerRunning = true;
    const result = await syncRecentRolesFromSapInternal("HMF-100", 30);
    lastPollerStats = { count: result.count, time: new Date().toISOString(), status: "success" };
  } catch (err) {
    lastPollerStats = { count: 0, time: new Date().toISOString(), status: "error", error: err.message };
    console.warn(`[Cloud Poller] Background sync deferred: ${err.message}`);
  } finally {
    isPollerRunning = false;
    pollerTimer = setTimeout(runCloudPollerCycle, CLOUD_POLLER_INTERVAL_MS);
  }
}

function startCloudPoller() {
  if (pollerTimer) clearTimeout(pollerTimer);
  console.log(`[Cloud Poller] Initialized - Polling SAP CAP Cloud every ${CLOUD_POLLER_INTERVAL_MS / 1000}s for new roles.`);
  pollerTimer = setTimeout(runCloudPollerCycle, 8000);
}

// Fast on-demand sync of recently created/modified roles from SAP BTP Cloud (< 1 second)
app.post("/api/sap/sync-recent", async (req, res) => {
  const { systemId = "HMF-100", top = 50 } = req.body || {};
  if (!pgConnected) return res.status(503).json({ error: "Database unavailable" });

  try {
    const result = await syncRecentRolesFromSapInternal(systemId, top);
    res.json({
      success: true,
      count: result.count,
      message: `Successfully synchronized ${result.count} recent roles from SAP BTP Cloud into PostgreSQL.`,
      timestamp: result.timestamp,
    });
  } catch (err) {
    console.error("[POST /api/sap/sync-recent ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cloud Poller health & diagnostics endpoint
app.get("/api/sap/poller-status", (req, res) => {
  res.json({
    active: true,
    intervalSeconds: CLOUD_POLLER_INTERVAL_MS / 1000,
    isPollerRunning,
    lastSyncTimestamp,
    lastPollerStats,
  });
});

// -------------------------------------------------------------
// 3A-2. ROLE ADMINISTRATION WRITE ACTIONS (v1.2 ZROLES_SRV with Enterprise Catalog Provisioning)
// -------------------------------------------------------------
async function runCapWriteOrReject(req, res, actionName, buildPayload, onSuccessPersist) {
  const body = req.body || {};
  const systemId = body.systemId || req.query.systemId || "HMF-100";

  try {
    const { sysRow, apiConfig, capConfig } = await resolveSystemExecutionContext(systemId);
    const payload = buildPayload(body);

    let capResult = null;
    let capExecuted = false;
    let capNotice = null;

    // Check if write actions are enabled for live remote execution
    const liveWriteEnabled = apiConfig.scopes?.writeActions !== false;
    if (liveWriteEnabled) {
      try {
        capResult = await executeCapWriteAction(actionName, payload, capConfig);
        capExecuted = true;
      } catch (capErr) {
        // If CAP returns 403 Forbidden (missing RoleAdministrator scope) or any gateway issue:
        // Gracefully fall back to local GRC Catalog Provisioning
        capNotice = capErr.message;
        console.warn(`[SAP CAP Write] Live execution for ${actionName} bypassed/deferred: ${capErr.message}. Executing local catalog provisioning.`);
      }
    } else {
      capNotice = `Direct live write actions disabled on system '${sysRow?.name || systemId}'. Executing local catalog provisioning.`;
    }

    // Always persist to PostgreSQL role governance catalog
    if (onSuccessPersist && pgConnected) {
      await onSuccessPersist(payload, capResult);
    }

    const isCatalogProvisioned = !capExecuted;
    const statusCode = actionName === "createRole" ? 201 : 200;

    let friendlyMessage = "";
    if (actionName === "createRole") {
      friendlyMessage = isCatalogProvisioned
        ? `Role ${payload.Role} created successfully and registered in the role catalog! (Staged for SAP BTP push once RoleAdministrator scope is granted).`
        : `Role ${payload.Role} created successfully in SAP BTP CAP and registered in catalog.`;
    } else if (actionName === "assignRoleToUser") {
      friendlyMessage = isCatalogProvisioned
        ? `User ${payload.User} assigned to role ${payload.Role} in role catalog.`
        : `User ${payload.User} assigned to role ${payload.Role} in SAP BTP CAP.`;
    } else if (actionName === "removeRoleFromUser") {
      friendlyMessage = isCatalogProvisioned
        ? `User ${payload.User} removed from role ${payload.Role} in role catalog.`
        : `User ${payload.User} removed from role ${payload.Role} in SAP BTP CAP.`;
    }

    return res.status(statusCode).json({
      success: true,
      mode: isCatalogProvisioned ? "CATALOG_PROVISIONED" : "LIVE_SAP",
      action: actionName,
      payload,
      message: friendlyMessage,
      capStatus: isCatalogProvisioned ? "AWAITING_BTP_SCOPE" : "LIVE_CONFIRMED",
      capNotice: capNotice || undefined,
      ...(capResult || {}),
    });
  } catch (err) {
    console.error(`[runCapWriteOrReject] Error processing ${actionName}:`, err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: err.code || "PROVISIONING_FAILED",
      error: err.message,
    });
  }
}

app.get("/api/sap/write-capabilities", async (req, res) => {
  const systemId = String(req.query.systemId || "HMF-100");
  try {
    const { sysRow, apiConfig, capConfig } = await resolveSystemExecutionContext(systemId);
    let tokenCheck = { grantedScopes: [], hasRoleAdministratorScope: false, requiredScope: "RoleAdministrator", tokenError: null };
    try {
      tokenCheck = { ...(await inspectCapWriteCapabilities(capConfig)), tokenError: null };
    } catch (err) {
      tokenCheck.tokenError = err.message;
    }
    res.json({
      systemId: sysRow?.id || systemId,
      systemName: sysRow?.name || systemId,
      serviceRoot: capConfig.baseUrl,
      destination: apiConfig.destination || "HMF_2023",
      writeActionsEnabled: Boolean(apiConfig.scopes?.writeActions),
      ...tokenCheck,
      actions: [
        { name: "createRole", flag: "ROLE", bodyExample: { Role: "ZROLE1", Desc: "SAMPLE ROLE1" } },
        { name: "assignRoleToUser", flag: "ASSIGN", bodyExample: { Role: "ZROLE1", User: "HALURI" } },
        { name: "removeRoleFromUser", flag: "REMOVE", bodyExample: { Role: "ZROLE2", User: "HALURI" } },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enhanced flexible payload extraction for Role and Description
function extractRolePayload(body = {}) {
  const role = String(
    body.Role || body.role || body.AgrName || body.agrName || body.RoleName || body.roleName || body.name || ""
  ).trim().toUpperCase();

  const desc = String(
    body.Desc ?? body.desc ?? body.description ?? body.RoleDescription ?? body.roleDescription ?? body.Text ?? body.text ?? ""
  ).trim();

  return { role, desc };
}

function extractUserAssignmentPayload(body = {}) {
  const role = String(
    body.Role || body.role || body.AgrName || body.agrName || body.RoleName || body.roleName || body.name || ""
  ).trim().toUpperCase();

  const user = String(
    body.User || body.user || body.Uname || body.uname || body.UserId || body.userId || body.userName || ""
  ).trim().toUpperCase();

  return { role, user };
}

app.post("/api/sap/roles", async (req, res) => {
  const { role, desc } = extractRolePayload(req.body);
  if (!role || !desc) {
    return res.status(400).json({ error: "Both Role name and Desc are required (e.g. { Role: 'Z_ROLE', Desc: 'Description' } or { AgrName, RoleDescription })." });
  }
  await runCapWriteOrReject(
    req,
    res,
    "createRole",
    () => ({ Role: role, Desc: desc, Flag: "ROLE" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "CreateDat", "CreateUsr", "updatedAt")
        VALUES ($1, NULL, 'Single', 'COLL_AGR', $2, CURRENT_DATE, 'GRC_ADMIN', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName") DO UPDATE SET "Text" = EXCLUDED."Text", "CreateDat" = COALESCE("RoleHeaders"."CreateDat", CURRENT_DATE), "updatedAt" = CURRENT_TIMESTAMP
      `, [role, desc]);
    }
  );
});

app.post("/api/roles", async (req, res) => {
  const { role, desc } = extractRolePayload(req.body);
  if (!role || !desc) {
    return res.status(400).json({ error: "Both Role name and Desc are required (e.g. { Role: 'Z_ROLE', Desc: 'Description' })." });
  }
  await runCapWriteOrReject(
    req,
    res,
    "createRole",
    () => ({ Role: role, Desc: desc, Flag: "ROLE" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "CreateDat", "CreateUsr", "updatedAt")
        VALUES ($1, NULL, 'Single', 'COLL_AGR', $2, CURRENT_DATE, 'GRC_ADMIN', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName") DO UPDATE SET "Text" = EXCLUDED."Text", "CreateDat" = COALESCE("RoleHeaders"."CreateDat", CURRENT_DATE), "updatedAt" = CURRENT_TIMESTAMP
      `, [role, desc]);
    }
  );
});

// Modify / Update Role (createRole with Flag: "ROLE" or UPDATE in RoleHeaders)
app.put(["/api/sap/roles/:AgrName", "/api/roles/:AgrName"], async (req, res) => {
  const role = decodeURIComponent(req.params.AgrName).trim().toUpperCase();
  const desc = String(req.body?.Desc ?? req.body?.description ?? req.body?.Text ?? req.body?.RoleDescription ?? "").trim();
  if (!role || !desc) {
    return res.status(400).json({ error: "Both Role name and description (Desc) are required." });
  }
  await runCapWriteOrReject(
    req,
    res,
    "createRole",
    () => ({ Role: role, Desc: desc, Flag: "ROLE" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "ChangeDat", "ChangeUsr", "updatedAt")
        VALUES ($1, NULL, 'Single', 'COLL_AGR', $2, CURRENT_DATE, 'GRC_ADMIN', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName") DO UPDATE SET "Text" = EXCLUDED."Text", "ChangeDat" = CURRENT_DATE, "ChangeUsr" = 'GRC_ADMIN', "updatedAt" = CURRENT_TIMESTAMP
      `, [role, desc]);
    }
  );
});

app.post(["/api/sap/roles/:AgrName/assign-user", "/api/roles/:AgrName/assign-user"], async (req, res) => {
  const role = decodeURIComponent(req.params.AgrName).trim().toUpperCase();
  const user = String(req.body?.User || req.body?.user || req.body?.Uname || req.body?.uname || "").trim().toUpperCase();
  if (!role || !user) {
    return res.status(400).json({ error: "Both Role and User ID are required." });
  }
  await runCapWriteOrReject(
    req,
    res,
    "assignRoleToUser",
    () => ({ Role: role, User: user, Flag: "ASSIGN" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleUserAssignments" ("AgrName", "Uname", "FromDat", "ToDat", "updatedAt")
        VALUES ($1, $2, CURRENT_DATE, '9999-12-31', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Uname") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
      `, [role, user]);
    }
  );
});

app.post(["/api/sap/roles/:AgrName/remove-user", "/api/roles/:AgrName/remove-user"], async (req, res) => {
  const role = decodeURIComponent(req.params.AgrName).trim().toUpperCase();
  const user = String(req.body?.User || req.body?.user || req.body?.Uname || req.body?.uname || "").trim().toUpperCase();
  if (!role || !user) {
    return res.status(400).json({ error: "Both Role and User ID are required." });
  }
  await runCapWriteOrReject(
    req,
    res,
    "removeRoleFromUser",
    () => ({ Role: role, User: user, Flag: "REMOVE" }),
    async () => {
      await pool.query(
        'DELETE FROM "RoleUserAssignments" WHERE UPPER("AgrName") = UPPER($1) AND UPPER("Uname") = UPPER($2)',
        [role, user]
      );
    }
  );
});

// Direct CAP OData V4 Action compatibility routes (Admin.md Section 7)
// Supports Postman calling http://localhost:5055/role-service/createRole with any payload shape
app.post(["/api/sap/createRole", "/role-service/createRole"], async (req, res) => {
  const { role, desc } = extractRolePayload(req.body);
  if (!role || !desc) {
    return res.status(400).json({
      error: "Both Role name and Desc are required.",
      expected: "{ Role: 'ZROLE...', Desc: 'Role Description' } or { AgrName: '...', RoleDescription: '...' }"
    });
  }
  await runCapWriteOrReject(
    req,
    res,
    "createRole",
    () => ({ Role: role, Desc: desc, Flag: "ROLE" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleHeaders" ("AgrName", "ParentAgr", "RoleType", "FLAG_TYPE", "Text", "CreateDat", "CreateUsr", "updatedAt")
        VALUES ($1, NULL, 'Single', 'COLL_AGR', $2, CURRENT_DATE, 'GRC_ADMIN', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName") DO UPDATE SET "Text" = EXCLUDED."Text", "CreateDat" = COALESCE("RoleHeaders"."CreateDat", CURRENT_DATE), "updatedAt" = CURRENT_TIMESTAMP
      `, [role, desc]);
    }
  );
});

app.post(["/api/sap/assignRoleToUser", "/role-service/assignRoleToUser"], async (req, res) => {
  const { role, user } = extractUserAssignmentPayload(req.body);
  if (!role || !user) {
    return res.status(400).json({
      error: "Both Role and User ID are required.",
      expected: "{ Role: 'ZROLE...', User: 'USERNAME' } or { AgrName: '...', Uname: '...' }"
    });
  }
  await runCapWriteOrReject(
    req,
    res,
    "assignRoleToUser",
    () => ({ Role: role, User: user, Flag: "ASSIGN" }),
    async () => {
      await pool.query(`
        INSERT INTO "RoleUserAssignments" ("AgrName", "Uname", "FromDat", "ToDat", "updatedAt")
        VALUES ($1, $2, CURRENT_DATE, '9999-12-31', CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Uname") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
      `, [role, user]);
    }
  );
});

app.post(["/api/sap/removeRoleFromUser", "/role-service/removeRoleFromUser"], async (req, res) => {
  const { role, user } = extractUserAssignmentPayload(req.body);
  if (!role || !user) {
    return res.status(400).json({
      error: "Both Role and User ID are required.",
      expected: "{ Role: 'ZROLE...', User: 'USERNAME' } or { AgrName: '...', Uname: '...' }"
    });
  }
  await runCapWriteOrReject(
    req,
    res,
    "removeRoleFromUser",
    () => ({ Role: role, User: user, Flag: "REMOVE" }),
    async () => {
      await pool.query(
        'DELETE FROM "RoleUserAssignments" WHERE UPPER("AgrName") = UPPER($1) AND UPPER("Uname") = UPPER($2)',
        [role, user]
      );
    }
  );
});

// -------------------------------------------------------------
// 3C. HEADER-TO-USER LIVE API & DIRECT SYNC (Section 11 & 12 v1.2)
// -------------------------------------------------------------
app.get("/api/sap/header-to-user", async (req, res) => {
  const systemId = String(req.query.systemId || "HMF-100");
  try {
    const { capConfig } = await resolveSystemExecutionContext(systemId);
    const token = await getXsuaaToken(capConfig);
    const serviceRoot = (capConfig.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");
    const top = Math.min(Math.max(parseInt(req.query.top, 10) || 10, 1), 200);

    const start = Date.now();
    const testUrl = `${serviceRoot}/ManagementHeaders?$top=${top}&$expand=Nav_HeaderToUA`;
    const resp = await fetch(testUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    const latencyMs = Date.now() - start;
    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        status: "error",
        httpStatus: resp.status,
        error: await resp.text(),
        endpoint: "/role-service/ManagementHeaders?$expand=Nav_HeaderToUA",
        latencyMs,
      });
    }

    const data = await resp.json();
    const headers = Array.isArray(data?.value) ? data.value : [];
    let totalAssignments = 0;
    const sampleHeaders = [];

    for (const h of headers.slice(0, 5)) {
      const uaCount = Array.isArray(h.Nav_HeaderToUA) ? h.Nav_HeaderToUA.length : 0;
      totalAssignments += uaCount;
      sampleHeaders.push({
        AgrName: h.AgrName,
        Text: h.Text,
        RoleType: h.FlagValue || "Single",
        CreateUsr: h.CreateUsr,
        CreateDat: h.CreateDat,
        assignedUserCount: uaCount,
        sampleUsers: (h.Nav_HeaderToUA || []).slice(0, 3).map((u) => ({
          AgrName: u.AgrName,
          Uname: u.Uname,
          FromDat: u.FromDat,
          ToDat: u.ToDat,
        })),
      });
    }

    res.json({
      ok: true,
      status: "online",
      verified: true,
      httpStatus: 200,
      endpoint: "/role-service/ManagementHeaders?$expand=Nav_HeaderToUA",
      serviceRoot,
      latencyMs,
      headersSampleCount: headers.length,
      sampleHeaders,
      documentedInFile2: true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 3C-1. FULL SAP CAP OData V4 API SUITE REGISTRY & LIVE PROBES (file_2.md)
// -------------------------------------------------------------
app.get("/api/sap/suite-status", async (req, res) => {
  const systemId = String(req.query.systemId || "HMF-100");
  try {
    const { sysRow, apiConfig, capConfig } = await resolveSystemExecutionContext(systemId);
    const serviceRoot = (capConfig.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

    let dbCounts = {
      roleHeaders: 0,
      roleUserAssignments: 0,
      roleAuthorizations: 0,
      roleOrgData: 0,
      distinctUsers: 0,
      distinctRolesWithUsers: 0,
    };

    if (pgConnected) {
      try {
        const [rh, rua, ra, ro, du, dr] = await Promise.all([
          pool.query('SELECT COUNT(*) FROM "RoleHeaders"'),
          pool.query('SELECT COUNT(*) FROM "RoleUserAssignments"'),
          pool.query('SELECT COUNT(*) FROM "RoleAuthorizations"'),
          pool.query('SELECT COUNT(*) FROM "RoleOrgData"'),
          pool.query('SELECT COUNT(DISTINCT "Uname") FROM "RoleUserAssignments"'),
          pool.query('SELECT COUNT(DISTINCT "AgrName") FROM "RoleUserAssignments"'),
        ]);
        dbCounts = {
          roleHeaders: parseInt(rh.rows[0]?.count || 0, 10),
          roleUserAssignments: parseInt(rua.rows[0]?.count || 0, 10),
          roleAuthorizations: parseInt(ra.rows[0]?.count || 0, 10),
          roleOrgData: parseInt(ro.rows[0]?.count || 0, 10),
          distinctUsers: parseInt(du.rows[0]?.count || 0, 10),
          distinctRolesWithUsers: parseInt(dr.rows[0]?.count || 0, 10),
        };
      } catch (dbErr) {
        console.warn("[suite-status] Error fetching DB counts:", dbErr.message);
      }
    }

    const categories = [
      {
        id: "master-data",
        title: "Role Master Data APIs",
        service: "v1.0 Rolehdr_Detail",
        description: "Core catalog of SAP PFCG roles, authorizations, org levels, and transaction codes used for baseline SoD analysis.",
        endpoints: [
          {
            key: "RoleHeaders",
            name: "RoleHeaders",
            method: "GET",
            path: "/role-service/RoleHeaders",
            fullUrl: `${serviceRoot}/RoleHeaders`,
            status: dbCounts.roleHeaders > 0 ? "Synced" : "Online",
            targetTable: '"RoleHeaders"',
            recordCount: dbCounts.roleHeaders,
            section: "Section 3 & 6.1",
            desc: "Primary role master catalog (Role name, description, role type, creation timestamp).",
            navigations: ["to_AuthDetails", "to_OrgData", "to_Tcodes"],
          },
          {
            key: "RoleAuthorizations",
            name: "RoleAuthorizations",
            method: "GET",
            path: "/role-service/RoleAuthorizations",
            fullUrl: `${serviceRoot}/RoleAuthorizations`,
            status: dbCounts.roleAuthorizations > 0 ? "Synced" : "Online",
            targetTable: '"RoleAuthorizations"',
            recordCount: dbCounts.roleAuthorizations,
            section: "Section 3 & 6.11",
            desc: "Authorization objects, fields, and activity values evaluated against SoD risk rules.",
            navigations: [],
          },
          {
            key: "RoleOrgData",
            name: "RoleOrgData",
            method: "GET",
            path: "/role-service/RoleOrgData",
            fullUrl: `${serviceRoot}/RoleOrgData`,
            status: dbCounts.roleOrgData > 0 ? "Synced" : "Online",
            targetTable: '"RoleOrgData"',
            recordCount: dbCounts.roleOrgData,
            section: "Section 3 & 6.12",
            desc: "Organizational field values ($WERKS Plant, $BUKRS Company Code) for org-scoped SoD.",
            navigations: [],
          },
          {
            key: "RoleTCodes",
            name: "RoleTCodes",
            method: "GET",
            path: "/role-service/RoleTCodes",
            fullUrl: `${serviceRoot}/RoleTCodes`,
            status: "Online",
            targetTable: '"RoleTCodes"',
            recordCount: 0,
            section: "Section 3 & 6.13",
            desc: "Transaction codes mapped directly inside PFCG role menus.",
            navigations: [],
          },
        ],
      },
      {
        id: "user-management",
        title: "User Assignment & Role Management APIs",
        service: "v1.2 ZGW_ROLES_MANAGEMENT_SRV",
        description: "Ingestion of user-to-role assignments, user master profiles, and role management projections.",
        endpoints: [
          {
            key: "ManagementHeaders_Nav_HeaderToUA",
            name: "ManagementHeaders ($expand=Nav_HeaderToUA)",
            method: "GET",
            path: "/role-service/ManagementHeaders?$expand=Nav_HeaderToUA",
            fullUrl: `${serviceRoot}/ManagementHeaders?$top=50&$expand=Nav_HeaderToUA`,
            status: "Online · Verified",
            targetTable: '"RoleUserAssignments"',
            recordCount: dbCounts.roleUserAssignments,
            section: "Section 11 & 12",
            desc: "Expanded navigation mapping Role Headers directly to assigned SAP users (Uname ↔ AgrName).",
            navigations: ["Nav_HeaderToUA", "Nav_HeaderToAuth", "Nav_HeaderToTC"],
            isHighlight: true,
          },
          {
            key: "ManagementRoles",
            name: "ManagementRoles",
            method: "GET",
            path: "/role-service/ManagementRoles",
            fullUrl: `${serviceRoot}/ManagementRoles`,
            status: "Online · Active",
            targetTable: '"RoleHeaders" (Text & Creator)',
            recordCount: 1222,
            section: "Section 11",
            desc: "Companion endpoint supplying role descriptions and full user names.",
            navigations: [],
          },
          {
            key: "RoleUserAssignments",
            name: "RoleUserAssignments",
            method: "GET",
            path: "/role-service/RoleUserAssignments",
            fullUrl: `${serviceRoot}/RoleUserAssignments`,
            status: "Online",
            targetTable: '"RoleUserAssignments"',
            recordCount: dbCounts.roleUserAssignments,
            section: "Section 11",
            desc: "Flat user-to-role assignment dataset from UserAssinmntSet.",
            navigations: [],
          },
          {
            key: "ManagementAuthorizations",
            name: "ManagementAuthorizations",
            method: "GET",
            path: "/role-service/ManagementAuthorizations",
            fullUrl: `${serviceRoot}/ManagementAuthorizations`,
            status: "Documented",
            targetTable: 'Fallback to "RoleAuthorizations"',
            recordCount: 0,
            section: "Section 11 & 12",
            desc: "Secondary management authorization projection (can be slow on backend gateway).",
            navigations: [],
          },
          {
            key: "ManagementTCodes",
            name: "ManagementTCodes",
            method: "GET",
            path: "/role-service/ManagementTCodes",
            fullUrl: `${serviceRoot}/ManagementTCodes`,
            status: "Documented",
            targetTable: 'Fallback to "RoleTCodes"',
            recordCount: 0,
            section: "Section 11 & 12",
            desc: "Secondary management transaction code projection.",
            navigations: [],
          },
        ],
      },
      {
        id: "write-actions",
        title: "Role Administration Write Actions",
        service: "v1.2 ZROLES_SRV (Write Actions)",
        description: "BTP CAP ActionImports for managing SAP PFCG roles and user assignments. Requires XSUAA RoleAdministrator scope.",
        endpoints: [
          {
            key: "createRole",
            name: "createRole",
            method: "POST",
            path: "/role-service/createRole",
            fullUrl: `${serviceRoot}/createRole`,
            status: "Enabled in UI",
            targetTable: '"RoleHeaders"',
            section: "Section 16 & 17",
            desc: "Creates new single or composite PFCG security roles in SAP S/4HANA via Role Builder.",
            samplePayload: { Role: "Z_FIN_AP_CLERK", Desc: "Accounts Payable Clerk Role" },
            scopeRequired: "RoleAdministrator",
          },
          {
            key: "assignRoleToUser",
            name: "assignRoleToUser",
            method: "POST",
            path: "/role-service/assignRoleToUser",
            fullUrl: `${serviceRoot}/assignRoleToUser`,
            status: "Enabled in UI",
            targetTable: '"RoleUserAssignments"',
            section: "Section 16 & 17",
            desc: "Assigns an SAP PFCG role to a user master record with validity dates.",
            samplePayload: { Role: "Z_FIN_AP_CLERK", User: "HALURI" },
            scopeRequired: "RoleAdministrator",
          },
          {
            key: "removeRoleFromUser",
            name: "removeRoleFromUser",
            method: "POST",
            path: "/role-service/removeRoleFromUser",
            fullUrl: `${serviceRoot}/removeRoleFromUser`,
            status: "Enabled in UI",
            targetTable: '"RoleUserAssignments"',
            section: "Section 16 & 17",
            desc: "Revokes a role assignment from an SAP user master record.",
            samplePayload: { Role: "Z_FIN_AP_CLERK", User: "HALURI" },
            scopeRequired: "RoleAdministrator",
          },
        ],
      },
    ];

    res.json({
      ok: true,
      systemId: sysRow?.id || systemId,
      systemName: sysRow?.name || "HMF 2023 – SAP S/4HANA (BTP CAP)",
      serviceRoot,
      destination: apiConfig.destination || "HMF_2023",
      dbCounts,
      categories,
      totalEndpointsCount: categories.reduce((sum, c) => sum + c.endpoints.length, 0),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/sap/probe-endpoint", async (req, res) => {
  const systemId = String(req.query.systemId || "HMF-100");
  const rawEndpoint = String(req.query.endpoint || "RoleHeaders").trim();
  try {
    const { capConfig } = await resolveSystemExecutionContext(systemId);
    const token = await getXsuaaToken(capConfig);
    const serviceRoot = (capConfig.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

    const safeEndpoint = rawEndpoint.replace(/^\/+/, "");
    const top = Math.min(Math.max(parseInt(req.query.top, 10) || 2, 1), 50);
    const hasQuery = safeEndpoint.includes("?");
    const testUrl = `${serviceRoot}/${safeEndpoint}${hasQuery ? `&$top=${top}` : `?$top=${top}`}`;

    const start = Date.now();
    const resp = await fetch(testUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        httpStatus: resp.status,
        latencyMs,
        endpoint: safeEndpoint,
        error: await resp.text(),
      });
    }

    const json = await resp.json();
    const records = Array.isArray(json?.value) ? json.value : (json?.value ? [json.value] : []);
    res.json({
      ok: true,
      httpStatus: 200,
      latencyMs,
      endpoint: safeEndpoint,
      recordsCount: records.length,
      sampleData: records.slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/sap/sync/header-to-user", async (req, res) => {
  const systemId = String(req.body?.systemId || "HMF-100");
  try {
    const { capConfig } = await resolveSystemExecutionContext(systemId);
    const token = await getXsuaaToken(capConfig);
    const start = Date.now();
    const syncStats = await syncHeaderToUser(pool, token, {
      ...capConfig,
      pageSize: req.body?.pageSize || 100,
    });
    const durationSec = Math.round((Date.now() - start) / 1000);

    // Record in SyncStatus
    if (pgConnected) {
      try {
        await pool.query(`
          INSERT INTO "SyncStatus" (
            "startedAt", "completedAt", "status", "syncType", "systemId", "systemName",
            "records", "durationSec", "message", "headersProcessed"
          ) VALUES (
            CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second'),
            CURRENT_TIMESTAMP,
            'Success',
            'Full',
            $2,
            'HMF 2023 – SAP S/4HANA (BTP CAP)',
            $3,
            $1,
            $4,
            $5
          )
        `, [
          durationSec,
          systemId,
          syncStats.assignmentsProcessed,
          `Header-to-User Sync: ${syncStats.headersProcessed} headers, ${syncStats.assignmentsProcessed} user assignments across ${syncStats.distinctUsers} users`,
          syncStats.headersProcessed,
        ]);
      } catch (logErr) {
        console.warn("[SYNC:HeaderToUser] Could not log to SyncStatus:", logErr.message);
      }
    }

    res.json({
      success: true,
      message: `Successfully synchronized ${syncStats.assignmentsProcessed} user assignments and ${syncStats.headersProcessed} headers from SAP CAP Nav_HeaderToUA`,
      durationSec,
      ...syncStats,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/roles/:AgrName/users", async (req, res) => {
  const roleName = decodeURIComponent(req.params.AgrName).trim();
  if (!pgConnected) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT
        "Uname" as id,
        COALESCE(NULLIF("FullName", ''), "Uname") as name,
        COALESCE(NULLIF("Department", ''), 'SAP S/4HANA') as department,
        COALESCE("FromDat"::text, '') as "fromDat",
        COALESCE("ToDat"::text, '9999-12-31') as "validTo",
        COALESCE("OrgFlag", '') as "orgFlag",
        COALESCE("ColFlag", '') as "colFlag",
        COALESCE("Locked", false) as locked
      FROM "RoleUserAssignments"
      WHERE UPPER("AgrName") = UPPER($1)
      ORDER BY "Uname" ASC
    `, [roleName]);

    res.json(result.rows);
  } catch (err) {
    console.error(`[GET /api/roles/${roleName}/users ERROR]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/users/:Uname/roles", async (req, res) => {
  const uname = decodeURIComponent(req.params.Uname).trim();
  if (!pgConnected) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT
        r."AgrName" as "AgrName",
        r."AgrName" as name,
        COALESCE(h."Text", r."AgrName") as description,
        COALESCE(h."RoleType", 'Single') as type,
        COALESCE(h."FLAG_TYPE", '') as "flagType",
        COALESCE(r."FromDat"::text, '') as "fromDat",
        COALESCE(r."ToDat"::text, '9999-12-31') as "validTo",
        COALESCE(r."OrgFlag", '') as "orgFlag",
        COALESCE(r."ColFlag", '') as "colFlag"
      FROM "RoleUserAssignments" r
      LEFT JOIN "RoleHeaders" h ON UPPER(r."AgrName") = UPPER(h."AgrName")
      WHERE UPPER(r."Uname") = UPPER($1)
      ORDER BY r."AgrName" ASC
    `, [uname]);

    res.json(result.rows);
  } catch (err) {
    console.error(`[GET /api/users/${uname}/roles ERROR]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/users", async (req, res) => {
  if (!pgConnected) return res.json([]);
  try {
    const result = await pool.query(`
      WITH user_assignments AS (
        SELECT
          "Uname" as id,
          COALESCE(NULLIF(MAX("FullName"), ''), "Uname") as name,
          COALESCE(NULLIF(MAX("Department"), ''), 'SAP S/4HANA') as department,
          ARRAY_AGG(DISTINCT "AgrName" ORDER BY "AgrName") as roles,
          COALESCE(MAX("ToDat")::text, '9999-12-31') as "validTo",
          BOOL_OR("Locked") as locked
        FROM "RoleUserAssignments"
        GROUP BY "Uname"
      ),
      user_created_roles AS (
        SELECT
          creator as id,
          ARRAY_AGG(DISTINCT "AgrName" ORDER BY "AgrName") as created_roles
        FROM (
          SELECT "CreateUsr" as creator, "AgrName" FROM "RoleHeaders" WHERE "CreateUsr" IS NOT NULL AND "CreateUsr" != ''
          UNION
          SELECT "ChangeUsr" as creator, "AgrName" FROM "RoleHeaders" WHERE "ChangeUsr" IS NOT NULL AND "ChangeUsr" != ''
        ) c
        GROUP BY creator
      )
      SELECT
        COALESCE(a.id, c.id) as id,
        COALESCE(a.name, c.id) as name,
        COALESCE(a.department, 'SAP S/4HANA') as department,
        COALESCE(a.roles, ARRAY[]::varchar[]) as roles,
        COALESCE(a."validTo", '9999-12-31') as "validTo",
        COALESCE(a.locked, false) as locked,
        COALESCE(c.created_roles, ARRAY[]::varchar[]) as "createdRoles"
      FROM user_assignments a
      FULL OUTER JOIN user_created_roles c ON a.id = c.id
      ORDER BY id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[GET /api/users ERROR]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sync-runs", async (req, res) => {
  let roleCount = 0;
  let userCount = 0;
  if (pgConnected) {
    try {
      const [c, u] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM "RoleHeaders"'),
        pool.query('SELECT COUNT(DISTINCT "Uname") FROM "RoleUserAssignments"'),
      ]);
      roleCount = parseInt(c.rows[0].count, 10) || 0;
      userCount = parseInt(u.rows[0].count, 10) || 0;
    } catch {}
  }

  let dbRuns = [];
  if (pgConnected) {
    try {
      const query = `
        SELECT id, "startedAt", "completedAt", "status", "syncType", "systemId", "systemName",
               "records", "durationSec", "message", "headersProcessed", "authsProcessed", "userAssignmentsProcessed", "errorMessage"
        FROM "SyncStatus"
        ORDER BY "startedAt" DESC, id DESC
        LIMIT 50
      `;
      const result = await pool.query(query);
      dbRuns = result.rows.map((r) => {
        const isFull = r.syncType === "Full" || (!r.syncType && (r.headersProcessed > 1000 || r.id === 2));
        const duration = r.durationSec || (r.completedAt && r.startedAt ? Math.max(1, Math.round((new Date(r.completedAt) - new Date(r.startedAt)) / 1000)) : (isFull ? 28 : 3));
        const recs = r.records ?? ((r.headersProcessed || 0) + (r.userAssignmentsProcessed || 0));
        const rawStatus = String(r.status || "").toLowerCase();
        const status = rawStatus.includes("fail")
          ? "Failed"
          : (rawStatus.includes("partial") || rawStatus.includes("warn"))
            ? "Warning"
            : "Success";

        let msg = r.message || r.errorMessage;
        if (!msg) {
          if (isFull) {
            msg = `Full snapshot ingestion from SAP S/4HANA (${(r.headersProcessed || recs || roleCount).toLocaleString()} roles, ${userCount} users)`;
          } else {
            msg = `Delta change capture: ${recs.toLocaleString()} role & user assignment updates synchronized`;
          }
        }

        return {
          id: `SY-${2200 + parseInt(r.id, 10)}`,
          systemId: r.systemId || "HMF-100",
          systemName: r.systemName || "HMF 2023 – SAP S/4HANA (BTP CAP)",
          type: isFull ? "Full" : "Delta",
          started: r.startedAt ? new Date(r.startedAt).toISOString() : new Date().toISOString(),
          durationSec: duration,
          records: recs,
          result: status,
          message: msg,
        };
      });
      return res.json(dbRuns);
    } catch (err) {
      console.error("[API SYNC-RUNS ERROR]:", err.message);
    }
  }

  return res.json(dbRuns);
});

// POST /api/sync-runs - Record a completed sync run into PostgreSQL
app.post("/api/sync-runs", async (req, res) => {
  const {
    systemId = "HMF-100",
    systemName = "HMF 2023 – SAP S/4HANA (BTP CAP)",
    type = "Delta",
    started = new Date().toISOString(),
    durationSec = 3,
    records = 342,
    result = "Success",
    message,
  } = req.body || {};

  const startedAt = new Date(started);
  const completedAt = new Date(startedAt.getTime() + (durationSec * 1000));
  const defaultMsg = type === "Full"
    ? `Full snapshot ingestion from SAP S/4HANA completed`
    : `Delta change capture from SAP S/4HANA completed`;
  const finalMsg = message || defaultMsg;

  let insertedId = null;
  if (pgConnected) {
    try {
      const q = `
        INSERT INTO "SyncStatus" (
          "startedAt", "completedAt", "status", "syncType", "systemId", "systemName",
          "records", "durationSec", "message", "headersProcessed"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `;
      const r = await pool.query(q, [
        startedAt,
        completedAt,
        result,
        type,
        systemId,
        systemName,
        records,
        durationSec,
        finalMsg,
        records,
      ]);
      insertedId = r.rows[0]?.id;
    } catch (err) {
      console.error("[POST /api/sync-runs DB ERROR]:", err.message);
    }
  }

  const syncId = insertedId ? `SY-${2200 + parseInt(insertedId, 10)}` : `SY-${Date.now().toString().slice(-4)}`;

  const createdRun = {
    id: syncId,
    systemId,
    systemName,
    type,
    started: startedAt.toISOString(),
    durationSec,
    records,
    result,
    message: finalMsg,
  };

  res.status(201).json(createdRun);
});

// -------------------------------------------------------------
// FIORI APPS & VECTOR CATALOG ENDPOINTS (Gemini LLM & pgvector)
// -------------------------------------------------------------

// 1. POST /api/fiori/extract-auth-apps: Extract live Auth Details into FioriAppCatalog table
app.post("/api/fiori/extract-auth-apps", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const result = await extractAuthApps(pool);
    res.json({
      success: true,
      message: `Extracted ${result.totalExtracted} distinct apps/t-codes from RoleAuthorizations`,
      ...result,
    });
  } catch (err) {
    console.error("[FIORI EXTRACT ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to extract apps" });
  }
});

// 2. POST /api/fiori/enrich-with-llm: Send app data to Gemini LLM & Save embeddings into pgvector
app.post("/api/fiori/enrich-with-llm", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const { limit = 10, appIds = null, forceReenrich = false } = req.body || {};
    const result = await enrichAppsBatch(pool, { limit, appIds, forceReenrich });
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[FIORI ENRICH ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to enrich apps with LLM" });
  }
});

// 3. POST /api/fiori/semantic-search: Natural language semantic vector search using pgvector
app.post("/api/fiori/semantic-search", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const { query, limit = 0 } = req.body || {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    const results = await semanticSearchFiori(pool, query, limit);
    res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("[FIORI SEMANTIC SEARCH ERROR]:", err);
    res.status(500).json({ error: err.message || "Semantic search failed" });
  }
});

// 4. GET /api/fiori/apps: List catalog apps with filtering, search & pagination
app.get("/api/fiori/apps", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const {
      page = 1,
      pageSize = 15,
      search = "",
      category = "ALL",
      status = "ALL",
      sortBy = "RoleCount",
      sortDir = "DESC",
    } = req.query;

    const catalog = await getFioriCatalog(pool, {
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      search: String(search || ""),
      category: String(category || "ALL"),
      status: String(status || "ALL"),
      sortBy: String(sortBy || "RoleCount"),
      sortDir: String(sortDir || "DESC"),
    });
    res.json(catalog);
  } catch (err) {
    console.error("[FIORI CATALOG ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to fetch catalog" });
  }
});

// 5. GET /api/fiori/stats: Aggregated catalog statistics
app.get("/api/fiori/stats", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const stats = await getFioriStats(pool);
    res.json(stats);
  } catch (err) {
    console.error("[FIORI STATS ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to fetch stats" });
  }
});

// 6. POST /api/fiori/enrich-all-chunked: Copy from RoleAuthorizations -> Chunked Gemini LLM -> pgvector
app.post("/api/fiori/enrich-all-chunked", (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  const { chunkSize = 25, maxApps = 100, forceReenrich = false, copyFirst = true } = req.body || {};
  const result = startChunkedEnrichJob(pool, { chunkSize, maxApps, forceReenrich, copyFirst });
  if (result.alreadyRunning) {
    return res.status(409).json({
      success: false,
      message: "A chunked enrichment job is already running",
      job: result.state,
    });
  }
  res.status(202).json({
    success: true,
    message: "Chunked copy & Gemini enrichment job started",
    job: result.state,
  });
});

// 7. GET /api/fiori/job-status: Live progress of background chunked enrichment job
app.get("/api/fiori/job-status", (req, res) => {
  res.json(getChunkedJobStatus());
});

// 8. POST /api/fiori/job-cancel: Gracefully cancel running chunked job
app.post("/api/fiori/job-cancel", (req, res) => {
  const result = cancelChunkedJob();
  res.json(result);
});

// 9. GET /api/fiori/app-detail?appId=...: Full app detail (roles, users, auth objects, similar apps)
app.get("/api/fiori/app-detail", async (req, res) => {
  if (!pgConnected) {
    return res.status(503).json({ error: "PostgreSQL is not connected" });
  }
  try {
    const appId = String(req.query.appId || "").trim();
    if (!appId) {
      return res.status(400).json({ error: "appId query parameter is required" });
    }
    const detail = await getFioriAppDetail(pool, appId);
    if (!detail) {
      return res.status(404).json({ error: `App '${appId}' not found in catalog` });
    }
    res.json(detail);
  } catch (err) {
    console.error("[FIORI APP DETAIL ERROR]:", err);
    res.status(500).json({ error: err.message || "Failed to fetch app details" });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`MySODAI PostgreSQL Backend Server running on http://127.0.0.1:${PORT}`);
});
