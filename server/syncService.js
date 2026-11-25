import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

export const DEFAULT_CONFIG = {
  baseUrl: process.env.SAP_BTP_BASE_URL || "https://mygo-consulting-inc-mygo-bas-4e8bz4sk-mygo-bas-zrole-he2315c850.cfapps.us10-001.hana.ondemand.com/role-service",
  authTokenUrl: process.env.SAP_BTP_TOKEN_URL || "https://mygo-bas-4e8bz4sk.authentication.us10.hana.ondemand.com/oauth/token",
  clientId: process.env.SAP_BTP_CLIENT_ID || "",
  clientSecret: process.env.SAP_BTP_CLIENT_SECRET || "",
};

// 1. Obtain OAuth 2.0 Bearer Token (returns token + granted scopes)
export async function getXsuaaTokenInfo(config = DEFAULT_CONFIG) {
  const clientId = config.clientId || DEFAULT_CONFIG.clientId;
  const clientSecret = config.clientSecret || DEFAULT_CONFIG.clientSecret;
  const authTokenUrl = config.authTokenUrl || DEFAULT_CONFIG.authTokenUrl;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");

  const resp = await fetch(authTokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`XSUAA Token Request Failed (${resp.status}): ${errorText}`);
  }

  const data = await resp.json();
  return {
    access_token: data.access_token,
    scope: data.scope || "",
  };
}

export async function getXsuaaToken(config = DEFAULT_CONFIG) {
  const info = await getXsuaaTokenInfo(config);
  return info.access_token;
}

export function normalizeSapDate(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || /^0+$/.test(s)) return null;
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    if (y === "0000" || m === "00" || d === "00") return null;
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return null;
}

export function normalizeSapTimestamp(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || /^0+\s*$/.test(s)) return null;
  try {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

export function normalizeSapTime(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || /^0+\s*$/.test(s)) return null;
  if (/^\d{6}$/.test(s)) {
    return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  }
  if (/^\d{2}:\d{2}/.test(s)) {
    return s.slice(0, 8);
  }
  return s;
}

function escapeODataString(val) {
  return String(val || "").replace(/'/g, "''");
}

// 2. Fetch and Save RoleHeaders with Pagination and UPSERT
export async function syncRoleHeaders(pool, token, options = {}) {
  const pageSize = options.pageSize || 100;
  const maxPages = options.maxPages || 5; // Default sync batch
  const serviceRoot = (options.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

  let skip = 0;
  let totalProcessed = 0;
  let page = 0;

  console.log(`[SYNC:RoleHeaders] Starting sync with pageSize=${pageSize}...`);

  const headersEp = (options.endpoints?.roleHeaders || "RoleHeaders").replace(/^\//, "");
  const isDelta = options.syncType === "Delta" || options.delta === true;
  const orderbyClause = options.orderby || (isDelta ? "CreateDat desc,ChangeDat desc" : "AgrName asc");
  while (page < maxPages) {
    const url = `${serviceRoot}/${headersEp}?$top=${pageSize}&$skip=${skip}&$orderby=${encodeURIComponent(orderbyClause)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch RoleHeaders: ${resp.status} ${await resp.text()}`);
    }

    const { value: records = [] } = await resp.json();
    if (records.length === 0) break;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of records) {
        await client.query(`
          INSERT INTO "RoleHeaders" (
            "AgrName", "ParentAgr", "CreateUsr", "CreateDat", "CreateTim", "CreateTmp",
            "ChangeUsr", "ChangeDat", "ChangeTim", "ChangeTmp", "Attributes", "FLAG_TYPE",
            "RoleType", "line", "Text", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName") DO UPDATE SET
            "ParentAgr" = EXCLUDED."ParentAgr",
            "CreateUsr" = EXCLUDED."CreateUsr",
            "CreateDat" = EXCLUDED."CreateDat",
            "CreateTim" = EXCLUDED."CreateTim",
            "CreateTmp" = EXCLUDED."CreateTmp",
            "ChangeUsr" = EXCLUDED."ChangeUsr",
            "ChangeDat" = EXCLUDED."ChangeDat",
            "ChangeTim" = EXCLUDED."ChangeTim",
            "ChangeTmp" = EXCLUDED."ChangeTmp",
            "Attributes" = EXCLUDED."Attributes",
            "FLAG_TYPE" = EXCLUDED."FLAG_TYPE",
            "RoleType" = EXCLUDED."RoleType",
            "line" = EXCLUDED."line",
            "Text" = EXCLUDED."Text",
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          r.AgrName,
          r.ParentAgr || null,
          r.CreateUsr || null,
          normalizeSapDate(r.CreateDat),
          r.CreateTim || null,
          r.CreateTmp || null,
          r.ChangeUsr || null,
          normalizeSapDate(r.ChangeDat),
          r.ChangeTim || null,
          r.ChangeTmp || null,
          r.Attributes || null,
          r.FLAG_TYPE || null,
          r.RoleType || "Single",
          r.line || null,
          r.Text || r.AgrName,
        ]);
      }
      await client.query("COMMIT");
      totalProcessed += records.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (records.length < pageSize) break;
    skip += pageSize;
    page++;
  }

  console.log(`[SYNC:RoleHeaders] Completed. Processed ${totalProcessed} records.`);
  return totalProcessed;
}

// 3. Fetch and Save RoleAuthorizations with Pagination and UPSERT
export async function syncRoleAuthorizations(pool, token, options = {}) {
  const pageSize = options.pageSize || 500;
  const maxPages = options.maxPages || 3;
  const serviceRoot = (options.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

  let skip = 0;
  let totalProcessed = 0;
  let page = 0;

  console.log(`[SYNC:RoleAuthorizations] Starting sync with pageSize=${pageSize}...`);

  const authsEp = (options.endpoints?.roleAuthorizations || "RoleAuthorizations").replace(/^\//, "");
  while (page < maxPages) {
    const url = `${serviceRoot}/${authsEp}?$top=${pageSize}&$skip=${skip}&$orderby=AgrName asc,Counter asc`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch RoleAuthorizations: ${resp.status} ${await resp.text()}`);
    }

    const { value: records = [] } = await resp.json();
    if (records.length === 0) break;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const a of records) {
        if (!a.AgrName || !a.Counter) continue;

        // Ensure parent RoleHeaders exists before foreign key insert
        await client.query(`
          INSERT INTO "RoleHeaders" ("AgrName", "RoleType", "Text")
          VALUES ($1, 'Single', $1)
          ON CONFLICT ("AgrName") DO NOTHING
        `, [a.AgrName]);

        await client.query(`
          INSERT INTO "RoleAuthorizations" (
            "AgrName", "Counter", "Object", "Auth", "Variant", "Field",
            "Low", "High", "Modified", "Deleted", "Copied", "Neu", "Node", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
            "Object" = EXCLUDED."Object",
            "Auth" = EXCLUDED."Auth",
            "Variant" = EXCLUDED."Variant",
            "Field" = EXCLUDED."Field",
            "Low" = EXCLUDED."Low",
            "High" = EXCLUDED."High",
            "Modified" = EXCLUDED."Modified",
            "Deleted" = EXCLUDED."Deleted",
            "Copied" = EXCLUDED."Copied",
            "Neu" = EXCLUDED."Neu",
            "Node" = EXCLUDED."Node",
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          a.AgrName,
          a.Counter,
          a.Object || null,
          a.Auth || null,
          a.Variant || null,
          a.Field || null,
          a.Low || null,
          a.High || null,
          a.Modified || null,
          !!a.Deleted,
          !!a.Copied,
          a.Neu || null,
          a.Node || null,
        ]);
      }
      await client.query("COMMIT");
      totalProcessed += records.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (records.length < pageSize) break;
    skip += pageSize;
    page++;
  }

  console.log(`[SYNC:RoleAuthorizations] Completed. Processed ${totalProcessed} records.`);
  return totalProcessed;
}

// 4. Fetch and Save RoleOrgData with Pagination and UPSERT
export async function syncRoleOrgData(pool, token, options = {}) {
  const pageSize = options.pageSize || 500;
  const maxPages = options.maxPages || 3;
  const serviceRoot = (options.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

  let skip = 0;
  let totalProcessed = 0;
  let page = 0;

  console.log(`[SYNC:RoleOrgData] Starting sync with pageSize=${pageSize}...`);

  const orgEp = (options.endpoints?.roleOrgData || "RoleOrgData").replace(/^\//, "");
  while (page < maxPages) {
    const url = `${serviceRoot}/${orgEp}?$top=${pageSize}&$skip=${skip}&$orderby=AgrName asc,Counter asc`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch RoleOrgData: ${resp.status} ${await resp.text()}`);
    }

    const { value: records = [] } = await resp.json();
    if (records.length === 0) break;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const o of records) {
        if (!o.AgrName || !o.Counter) continue;

        await client.query(`
          INSERT INTO "RoleHeaders" ("AgrName", "RoleType", "Text")
          VALUES ($1, 'Single', $1)
          ON CONFLICT ("AgrName") DO NOTHING
        `, [o.AgrName]);

        await client.query(`
          INSERT INTO "RoleOrgData" (
            "AgrName", "Counter", "Varbl", "Low", "High", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
            "Varbl" = EXCLUDED."Varbl",
            "Low" = EXCLUDED."Low",
            "High" = EXCLUDED."High",
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          o.AgrName,
          o.Counter,
          o.Varbl || null,
          o.Low || null,
          o.High || null,
        ]);
      }
      await client.query("COMMIT");
      totalProcessed += records.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (records.length < pageSize) break;
    skip += pageSize;
    page++;
  }

  console.log(`[SYNC:RoleOrgData] Completed. Processed ${totalProcessed} records.`);
  return totalProcessed;
}

// 5. Fetch and Save RoleTCodes with Pagination and UPSERT
export async function syncRoleTCodes(pool, token, options = {}) {
  const pageSize = options.pageSize || 500;
  const maxPages = options.maxPages || 3;
  const serviceRoot = (options.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

  let skip = 0;
  let totalProcessed = 0;
  let page = 0;

  console.log(`[SYNC:RoleTCodes] Starting sync with pageSize=${pageSize}...`);

  const tcodesEp = (options.endpoints?.roleTCodes || "RoleTCodes").replace(/^\//, "");
  while (page < maxPages) {
    const url = `${serviceRoot}/${tcodesEp}?$top=${pageSize}&$skip=${skip}&$orderby=AgrName asc,Counter asc`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch RoleTCodes: ${resp.status} ${await resp.text()}`);
    }

    const { value: records = [] } = await resp.json();
    if (records.length === 0) {
      console.log(`[SYNC:RoleTCodes] Endpoint returned 0 records (as documented in Section 9). Recording accurately.`);
      break;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const t of records) {
        if (!t.AgrName || !t.Counter) continue;

        await client.query(`
          INSERT INTO "RoleHeaders" ("AgrName", "RoleType", "Text")
          VALUES ($1, 'Single', $1)
          ON CONFLICT ("AgrName") DO NOTHING
        `, [t.AgrName]);

        await client.query(`
          INSERT INTO "RoleTCodes" (
            "AgrName", "Counter", "Reporttype", "Report", "ParMenu", "ParReport", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
            "Reporttype" = EXCLUDED."Reporttype",
            "Report" = EXCLUDED."Report",
            "ParMenu" = EXCLUDED."ParMenu",
            "ParReport" = EXCLUDED."ParReport",
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          t.AgrName,
          t.Counter,
          t.Reporttype || null,
          t.Report || null,
          t.ParMenu || null,
          t.ParReport || null,
        ]);
      }
      await client.query("COMMIT");
      totalProcessed += records.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (records.length < pageSize) break;
    skip += pageSize;
    page++;
  }

  console.log(`[SYNC:RoleTCodes] Completed. Processed ${totalProcessed} records.`);
  return totalProcessed;
}

async function fetchPagedAssignmentSet(serviceRoot, endpoint, token, pageSize, maxPages) {
  let skip = 0;
  let page = 0;
  const collected = [];
  const seenKeys = new Set();

  while (page < maxPages) {
    const url = `${serviceRoot}/${endpoint}?$top=${pageSize}&$skip=${skip}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch ${endpoint}: ${resp.status} ${await resp.text()}`);
    }

    const body = await resp.json();
    const records = Array.isArray(body?.value) ? body.value : [];
    if (records.length === 0) break;

    let newInPage = 0;
    for (const rec of records) {
      const agrName = (rec.AgrName || rec.Agr_name || rec.AGR_NAME || "").trim();
      const uname = (rec.Uname || rec.UNAME || "").trim();
      if (!agrName || !uname) continue;
      const key = `${agrName}::${uname}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        newInPage++;
      }
      collected.push({ ...rec, _agrName: agrName, _uname: uname });
    }

    // ZGW_ROLES_MANAGEMENT_SRV caveat: backend ignores $top/$skip and returns the full set on page 1
    if (records.length < pageSize || records.length > pageSize || newInPage === 0 || !body["@odata.nextLink"]) {
      if (records.length === pageSize && newInPage > 0) {
        skip += pageSize;
        page++;
        continue;
      }
      break;
    }
    skip += pageSize;
    page++;
  }

  return collected;
}

// 5b. Fetch and Save RoleUserAssignments + ManagementRoles enrichment (ZGW_ROLES_MANAGEMENT_SRV)
export async function syncRoleUserAssignments(pool, token, options = {}) {
  const pageSize = options.pageSize || 200;
  const maxPages = options.maxPages || 10;
  const serviceRoot = (options.baseUrl || options.config?.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");
  const primaryEp = (options.endpoints?.userAssignments && options.endpoints.userAssignments !== "RoleUserAssignments" ? options.endpoints.userAssignments : "RoleUsers").replace(/^\//, "");
  const secondaryEp = primaryEp === "ManagementRoles" ? "RoleUserAssignments" : "ManagementRoles";

  console.log(`[SYNC:RoleUserAssignments] Starting sync from ${primaryEp} (+ ${secondaryEp} enrichment)...`);

  const mergedByKey = new Map();
  const roleDescMap = new Map();

  const applyRecord = (rec) => {
    const key = `${rec._agrName}::${rec._uname}`;
    const prev = mergedByKey.get(key) || {
      AgrName: rec._agrName,
      Uname: rec._uname,
      FromDat: null,
      ToDat: null,
      OrgFlag: null,
      ColFlag: null,
      Department: null,
      FullName: null,
      Locked: false,
    };

    const fromDat = normalizeSapDate(rec.FromDat || rec.Fdate);
    const toDat = normalizeSapDate(rec.ToDat || rec.Tdate);

    mergedByKey.set(key, {
      AgrName: rec._agrName,
      Uname: rec._uname,
      FromDat: fromDat || prev.FromDat,
      ToDat: toDat || prev.ToDat,
      OrgFlag: rec.OrgFlag ?? prev.OrgFlag,
      ColFlag: rec.ColFlag ?? prev.ColFlag,
      Department: rec.Department || prev.Department,
      FullName: (rec.FullName && rec.FullName.trim()) || prev.FullName,
      Locked: Boolean(rec.Locked ?? prev.Locked),
    });

    if (rec.Desc && rec.Desc.trim()) {
      roleDescMap.set(rec._agrName, rec.Desc.trim());
    }
  };

  const primaryRecords = await fetchPagedAssignmentSet(serviceRoot, primaryEp, token, pageSize, maxPages);
  for (const r of primaryRecords) applyRecord(r);

  // Best-effort enrichment from the companion endpoint (e.g. ManagementRoles supplies FullName & Desc)
  try {
    const secondaryRecords = await fetchPagedAssignmentSet(serviceRoot, secondaryEp, token, pageSize, maxPages);
    for (const r of secondaryRecords) applyRecord(r);
  } catch (enrichErr) {
    console.warn(`[SYNC:RoleUserAssignments] Companion ${secondaryEp} skipped: ${enrichErr.message}`);
  }

  const uniqueRows = Array.from(mergedByKey.values());
  if (uniqueRows.length === 0) {
    console.log("[SYNC:RoleUserAssignments] Completed. 0 records returned.");
    return 0;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of uniqueRows) {
      await client.query(`
        INSERT INTO "RoleUserAssignments" (
          "AgrName", "Uname", "FromDat", "ToDat", "OrgFlag", "ColFlag",
          "Department", "FullName", "Locked", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Uname") DO UPDATE SET
          "FromDat" = COALESCE(EXCLUDED."FromDat", "RoleUserAssignments"."FromDat"),
          "ToDat" = COALESCE(EXCLUDED."ToDat", "RoleUserAssignments"."ToDat"),
          "OrgFlag" = COALESCE(EXCLUDED."OrgFlag", "RoleUserAssignments"."OrgFlag"),
          "ColFlag" = COALESCE(EXCLUDED."ColFlag", "RoleUserAssignments"."ColFlag"),
          "Department" = COALESCE(EXCLUDED."Department", "RoleUserAssignments"."Department"),
          "FullName" = COALESCE(NULLIF(EXCLUDED."FullName", ''), "RoleUserAssignments"."FullName"),
          "Locked" = EXCLUDED."Locked",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [
        r.AgrName,
        r.Uname,
        r.FromDat,
        r.ToDat,
        r.OrgFlag || null,
        r.ColFlag || null,
        r.Department || null,
        r.FullName || null,
        Boolean(r.Locked),
      ]);
    }

    for (const [agrName, desc] of roleDescMap.entries()) {
      await client.query(`
        UPDATE "RoleHeaders"
        SET "Text" = $2, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "AgrName" = $1 AND ("Text" IS NULL OR "Text" = '' OR "Text" = "AgrName")
      `, [agrName, desc]);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  console.log(`[SYNC:RoleUserAssignments] Completed. Processed ${uniqueRows.length} unique assignments.`);
  return uniqueRows.length;
}

// 5c. Fetch and Save Header-to-User Navigation (Section 11 & 12: ManagementHeaders?$expand=Nav_HeaderToUA)
export async function syncHeaderToUser(pool, token, options = {}) {
  const pageSize = options.pageSize || 100;
  const serviceRoot = (options.baseUrl || options.config?.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");

  console.log(`[SYNC:HeaderToUser] Connecting to SAP CAP ManagementHeaders?$top=${pageSize}&$expand=Nav_HeaderToUA...`);
  const headersUrl = `${serviceRoot}/ManagementHeaders?$top=${pageSize}&$expand=Nav_HeaderToUA`;
  const resp = await fetch(headersUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(45000),
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ManagementHeaders?$expand=Nav_HeaderToUA: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const mgmtHeaders = Array.isArray(data?.value) ? data.value : [];
  console.log(`[SYNC:HeaderToUser] Retrieved ${mgmtHeaders.length} ManagementHeaders with Nav_HeaderToUA`);

  // Companion ManagementRoles for FullName & descriptions
  let companionMr = [];
  try {
    const mrResp = await fetch(`${serviceRoot}/ManagementRoles?$top=2000`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (mrResp.ok) {
      const mrData = await mrResp.json();
      companionMr = Array.isArray(mrData?.value) ? mrData.value : [];
    }
  } catch (e) {
    console.warn(`[SYNC:HeaderToUser] Companion ManagementRoles skipped: ${e.message}`);
  }

  const assignmentsMap = new Map();
  const headerMap = new Map();
  const roleDescMap = new Map();

  for (const h of mgmtHeaders) {
    const hAgr = (h.AgrName || "").trim();
    if (hAgr) {
      headerMap.set(hAgr, {
        AgrName: hAgr,
        ParentAgr: (h.ParentAgr || "").trim() || null,
        CreateUsr: (h.CreateUsr || "").trim() || null,
        CreateDat: normalizeSapDate(h.CreateDat),
        CreateTim: normalizeSapTime(h.CreateTim),
        CreateTmp: normalizeSapTimestamp(h.CreateTmp),
        ChangeUsr: (h.ChangeUsr || "").trim() || null,
        ChangeDat: normalizeSapDate(h.ChangeDat),
        ChangeTim: normalizeSapTime(h.ChangeTim),
        ChangeTmp: normalizeSapTimestamp(h.ChangeTmp),
        Attributes: (h.Attributes || "").trim() || null,
        FLAG_TYPE: (h.FlagType || "").trim() || null,
        RoleType: (h.FlagValue || "Single").trim(),
        line: (h.Line || "00000").trim(),
        Text: (h.Text || "").trim() || hAgr,
      });
      if (h.Text && h.Text.trim()) roleDescMap.set(hAgr, h.Text.trim());
    }

    if (Array.isArray(h.Nav_HeaderToUA)) {
      for (const ua of h.Nav_HeaderToUA) {
        const agr = (ua.AgrName || "").trim();
        const usr = (ua.Uname || "").trim();
        if (!agr || !usr) continue;
        const key = `${agr}::${usr}`;
        if (!assignmentsMap.has(key)) {
          assignmentsMap.set(key, {
            AgrName: agr,
            Uname: usr,
            FromDat: normalizeSapDate(ua.FromDat),
            ToDat: normalizeSapDate(ua.ToDat) || "9999-12-31",
            OrgFlag: ua.OrgFlag || null,
            ColFlag: ua.ColFlag || null,
            Department: "SAP S/4HANA",
            FullName: null,
            Locked: false,
          });
        }
      }
    }
  }

  for (const mr of companionMr) {
    const agr = (mr.Agr_name || mr.AgrName || "").trim();
    const usr = (mr.Uname || "").trim();
    if (!agr || !usr) continue;
    const key = `${agr}::${usr}`;
    const prev = assignmentsMap.get(key);
    const fullName = (mr.FullName && mr.FullName.trim()) || prev?.FullName || null;
    const fromDat = normalizeSapDate(mr.Fdate) || prev?.FromDat || null;
    const toDat = normalizeSapDate(mr.Tdate) || prev?.ToDat || "9999-12-31";

    assignmentsMap.set(key, {
      AgrName: agr,
      Uname: usr,
      FromDat: fromDat,
      ToDat: toDat,
      OrgFlag: prev?.OrgFlag ?? null,
      ColFlag: prev?.ColFlag ?? null,
      Department: prev?.Department || "SAP S/4HANA",
      FullName: fullName,
      Locked: Boolean(prev?.Locked),
    });

    if (mr.Desc && mr.Desc.trim()) {
      roleDescMap.set(agr, mr.Desc.trim());
    }
  }

  const client = await pool.connect();
  let headersSaved = 0;
  let assignmentsSaved = 0;

  try {
    await client.query("BEGIN");

    for (const h of headerMap.values()) {
      await client.query(`
        INSERT INTO "RoleHeaders" (
          "AgrName", "ParentAgr", "CreateUsr", "CreateDat", "CreateTim", "CreateTmp",
          "ChangeUsr", "ChangeDat", "ChangeTim", "ChangeTmp", "Attributes", "FLAG_TYPE",
          "RoleType", "line", "Text", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName") DO UPDATE SET
          "ParentAgr" = COALESCE(EXCLUDED."ParentAgr", "RoleHeaders"."ParentAgr"),
          "CreateUsr" = COALESCE(EXCLUDED."CreateUsr", "RoleHeaders"."CreateUsr"),
          "CreateDat" = COALESCE(EXCLUDED."CreateDat", "RoleHeaders"."CreateDat"),
          "CreateTim" = COALESCE(EXCLUDED."CreateTim", "RoleHeaders"."CreateTim"),
          "ChangeUsr" = COALESCE(EXCLUDED."ChangeUsr", "RoleHeaders"."ChangeUsr"),
          "ChangeDat" = COALESCE(EXCLUDED."ChangeDat", "RoleHeaders"."ChangeDat"),
          "ChangeTim" = COALESCE(EXCLUDED."ChangeTim", "RoleHeaders"."ChangeTim"),
          "FLAG_TYPE" = COALESCE(EXCLUDED."FLAG_TYPE", "RoleHeaders"."FLAG_TYPE"),
          "RoleType" = COALESCE(EXCLUDED."RoleType", "RoleHeaders"."RoleType"),
          "Text" = COALESCE(NULLIF(EXCLUDED."Text", ''), "RoleHeaders"."Text"),
          "updatedAt" = CURRENT_TIMESTAMP
      `, [
        h.AgrName, h.ParentAgr, h.CreateUsr, h.CreateDat, h.CreateTim, h.CreateTmp,
        h.ChangeUsr, h.ChangeDat, h.ChangeTim, h.ChangeTmp, h.Attributes, h.FLAG_TYPE,
        h.RoleType, h.line, h.Text
      ]);
      headersSaved++;
    }

    for (const r of assignmentsMap.values()) {
      await client.query(`
        INSERT INTO "RoleUserAssignments" (
          "AgrName", "Uname", "FromDat", "ToDat", "OrgFlag", "ColFlag",
          "Department", "FullName", "Locked", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Uname") DO UPDATE SET
          "FromDat" = COALESCE(EXCLUDED."FromDat", "RoleUserAssignments"."FromDat"),
          "ToDat" = COALESCE(EXCLUDED."ToDat", "RoleUserAssignments"."ToDat"),
          "OrgFlag" = COALESCE(EXCLUDED."OrgFlag", "RoleUserAssignments"."OrgFlag"),
          "ColFlag" = COALESCE(EXCLUDED."ColFlag", "RoleUserAssignments"."ColFlag"),
          "Department" = COALESCE(EXCLUDED."Department", "RoleUserAssignments"."Department"),
          "FullName" = COALESCE(NULLIF(EXCLUDED."FullName", ''), "RoleUserAssignments"."FullName"),
          "Locked" = EXCLUDED."Locked",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [
        r.AgrName, r.Uname, r.FromDat, r.ToDat, r.OrgFlag, r.ColFlag,
        r.Department, r.FullName, Boolean(r.Locked)
      ]);
      assignmentsSaved++;
    }

    for (const [agrName, desc] of roleDescMap.entries()) {
      await client.query(`
        UPDATE "RoleHeaders"
        SET "Text" = $2, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "AgrName" = $1 AND ("Text" IS NULL OR "Text" = '' OR "Text" = "AgrName")
      `, [agrName, desc]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`[SYNC:HeaderToUser] Completed. Saved ${headersSaved} headers and ${assignmentsSaved} user assignments.`);
  return {
    headersProcessed: headersSaved,
    assignmentsProcessed: assignmentsSaved,
    distinctRoles: new Set([...assignmentsMap.values()].map((a) => a.AgrName)).size,
    distinctUsers: new Set([...assignmentsMap.values()].map((a) => a.Uname)).size,
  };
}

// 5b-2. Single-Role On-Demand Direct Query Sync (Section 5 & Section 6 #11 - bypasses 0..1 $expand limit)
export async function syncSingleRoleFromSap(pool, roleName, config = DEFAULT_CONFIG, endpoints = {}) {
  const serviceRoot = (config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");
  const token = await getXsuaaToken(config);
  const escaped = escapeODataString(roleName);

  const headersEp = (endpoints.roleHeaders || "RoleHeaders").replace(/^\//, "");
  const authsEp = (endpoints.roleAuthorizations || "RoleAuthorizations").replace(/^\//, "");
  const orgEp = (endpoints.roleOrgData || "RoleOrgData").replace(/^\//, "");
  const tcodesEp = (endpoints.roleTCodes || "RoleTCodes").replace(/^\//, "");

  const fetchJson = async (url) => {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) {
      throw new Error(`SAP CAP request failed (${resp.status}): ${await resp.text()}`);
    }
    const body = await resp.json();
    return Array.isArray(body?.value) ? body.value : [];
  };

  const fetchAllFiltered = async (ep, orderBy) => {
    const all = [];
    let skip = 0;
    const pageSize = 500;
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({
        $filter: `AgrName eq '${escaped}'`,
        $top: String(pageSize),
        $skip: String(skip),
      });
      if (orderBy) qs.set("$orderby", orderBy);
      const batch = await fetchJson(`${serviceRoot}/${ep}?${qs.toString().replace(/\+/g, "%20")}`);
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < pageSize) break;
      skip += pageSize;
    }
    return all;
  };

  const [headers, auths, orgData, tcodes, userAssignments] = await Promise.all([
    fetchJson(`${serviceRoot}/${headersEp}?$filter=${encodeURIComponent(`AgrName eq '${escaped}'`)}`).catch(() => []),
    fetchAllFiltered(authsEp, "Counter asc"),
    fetchAllFiltered(orgEp, "Counter asc"),
    fetchAllFiltered(tcodesEp, "Counter asc").catch(() => []),
    fetchJson(`${serviceRoot}/RoleUsers?$filter=${encodeURIComponent(`AgrName eq '${escaped}'`)}`).catch(() => []),
  ]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (headers.length > 0) {
      for (const r of headers) {
        await client.query(`
          INSERT INTO "RoleHeaders" (
            "AgrName", "ParentAgr", "CreateUsr", "CreateDat", "CreateTim", "CreateTmp",
            "ChangeUsr", "ChangeDat", "ChangeTim", "ChangeTmp", "Attributes", "FLAG_TYPE",
            "RoleType", "line", "Text", "updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)
          ON CONFLICT ("AgrName") DO UPDATE SET
            "ParentAgr" = EXCLUDED."ParentAgr",
            "CreateUsr" = EXCLUDED."CreateUsr",
            "CreateDat" = EXCLUDED."CreateDat",
            "CreateTim" = EXCLUDED."CreateTim",
            "CreateTmp" = EXCLUDED."CreateTmp",
            "ChangeUsr" = EXCLUDED."ChangeUsr",
            "ChangeDat" = EXCLUDED."ChangeDat",
            "ChangeTim" = EXCLUDED."ChangeTim",
            "ChangeTmp" = EXCLUDED."ChangeTmp",
            "Attributes" = EXCLUDED."Attributes",
            "FLAG_TYPE" = EXCLUDED."FLAG_TYPE",
            "RoleType" = EXCLUDED."RoleType",
            "line" = EXCLUDED."line",
            "Text" = EXCLUDED."Text",
            "updatedAt" = CURRENT_TIMESTAMP
        `, [
          r.AgrName || roleName,
          r.ParentAgr || null,
          r.CreateUsr || null,
          normalizeSapDate(r.CreateDat),
          normalizeSapTime(r.CreateTim),
          normalizeSapTimestamp(r.CreateTmp),
          r.ChangeUsr || null,
          normalizeSapDate(r.ChangeDat),
          normalizeSapTime(r.ChangeTim),
          normalizeSapTimestamp(r.ChangeTmp),
          r.Attributes || null,
          r.FLAG_TYPE || null,
          r.RoleType || "Single",
          r.line || null,
          r.Text || r.AgrName || roleName,
        ]);
      }
    } else {
      await client.query(`
        INSERT INTO "RoleHeaders" ("AgrName", "RoleType", "Text")
        VALUES ($1, 'Single', $1)
        ON CONFLICT ("AgrName") DO NOTHING
      `, [roleName]);
    }

    if (userAssignments.length > 0) {
      for (const ua of userAssignments) {
        const uname = (ua.Uname || ua.UNAME || "").trim();
        if (!uname) continue;
        await client.query(`
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
          roleName,
          uname,
          normalizeSapDate(ua.FromDat),
          normalizeSapDate(ua.ToDat) || "9999-12-31",
          ua.OrgFlag || null,
          ua.ColFlag || null,
          "SAP S/4HANA",
          null,
          false,
        ]);
      }
    }

    for (const a of auths) {
      if (!a.AgrName || !a.Counter) continue;
      await client.query(`
        INSERT INTO "RoleAuthorizations" (
          "AgrName", "Counter", "Object", "Auth", "Variant", "Field",
          "Low", "High", "Modified", "Deleted", "Copied", "Neu", "Node", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
          "Object" = EXCLUDED."Object",
          "Auth" = EXCLUDED."Auth",
          "Variant" = EXCLUDED."Variant",
          "Field" = EXCLUDED."Field",
          "Low" = EXCLUDED."Low",
          "High" = EXCLUDED."High",
          "Modified" = EXCLUDED."Modified",
          "Deleted" = EXCLUDED."Deleted",
          "Copied" = EXCLUDED."Copied",
          "Neu" = EXCLUDED."Neu",
          "Node" = EXCLUDED."Node",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [
        a.AgrName,
        a.Counter,
        a.Object || null,
        a.Auth || null,
        a.Variant || null,
        a.Field || null,
        a.Low || null,
        a.High || null,
        a.Modified || null,
        Boolean(a.Deleted),
        Boolean(a.Copied),
        a.Neu || null,
        a.Node || null,
      ]);
    }

    for (const o of orgData) {
      if (!o.AgrName || !o.Counter) continue;
      await client.query(`
        INSERT INTO "RoleOrgData" ("AgrName", "Counter", "Varbl", "Low", "High", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
          "Varbl" = EXCLUDED."Varbl",
          "Low" = EXCLUDED."Low",
          "High" = EXCLUDED."High",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [o.AgrName, o.Counter, o.Varbl || null, o.Low || null, o.High || null]);
    }

    for (const t of tcodes) {
      if (!t.AgrName || !t.Counter) continue;
      await client.query(`
        INSERT INTO "RoleTCodes" ("AgrName", "Counter", "Reporttype", "Report", "ParMenu", "ParReport", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
        ON CONFLICT ("AgrName", "Counter") DO UPDATE SET
          "Reporttype" = EXCLUDED."Reporttype",
          "Report" = EXCLUDED."Report",
          "ParMenu" = EXCLUDED."ParMenu",
          "ParReport" = EXCLUDED."ParReport",
          "updatedAt" = CURRENT_TIMESTAMP
      `, [t.AgrName, t.Counter, t.Reporttype || null, t.Report || null, t.ParMenu || null, t.ParReport || null]);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return {
    roleName,
    headersCount: headers.length,
    authsCount: auths.length,
    orgDataCount: orgData.length,
    tcodesCount: tcodes.length,
  };
}

// 5b-3. Role Administration Write Actions (v1.2 ZROLES_SRV - Sections 16-18)
const VALID_CAP_WRITE_ACTIONS = new Set(["createRole", "assignRoleToUser", "removeRoleFromUser"]);

export async function inspectCapWriteCapabilities(config = DEFAULT_CONFIG) {
  const info = await getXsuaaTokenInfo(config);
  const grantedScopes = String(info.scope || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasRoleAdministratorScope = grantedScopes.some((s) => s.includes("RoleAdministrator"));
  return {
    grantedScopes,
    hasRoleAdministratorScope,
    requiredScope: "RoleAdministrator",
  };
}

export async function executeCapWriteAction(actionName, payload, config = DEFAULT_CONFIG) {
  if (!VALID_CAP_WRITE_ACTIONS.has(actionName)) {
    const err = new Error(`Unsupported CAP write action: ${actionName}`);
    err.statusCode = 400;
    throw err;
  }

  const serviceRoot = (config.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");
  const tokenInfo = await getXsuaaTokenInfo(config);
  const grantedScopes = String(tokenInfo.scope || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasAdminScope = grantedScopes.some((s) => s.includes("RoleAdministrator"));

  const url = `${serviceRoot}/${actionName}`;
  const capPayload = {};
  if (payload.Role) capPayload.Role = payload.Role;
  if (actionName === "createRole" && payload.Desc) capPayload.Desc = payload.Desc;
  if ((actionName === "assignRoleToUser" || actionName === "removeRoleFromUser") && payload.User) {
    capPayload.User = payload.User;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenInfo.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(capPayload),
    signal: AbortSignal.timeout(25000),
  });

  const rawText = await resp.text();
  let parsedBody = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = rawText;
  }

  if (resp.status === 403 || !resp.ok) {
    const capMsg =
      parsedBody?.error?.message?.value ||
      parsedBody?.error?.message ||
      (typeof parsedBody === "string" ? parsedBody : `HTTP ${resp.status}`);

    const err = new Error(
      resp.status === 403
        ? `CAP returned HTTP 403 Forbidden for /${actionName}. ${
            hasAdminScope
              ? "XSUAA client has RoleAdministrator, so verify BTP/SAP gateway role authorization."
              : `OAuth client token has [${grantedScopes.join(", ") || "no scopes"}] and is missing the 'RoleAdministrator' scope. Also verify ZROLES_SRV/Create_roleSet write support with SAP Basis/Security.`
          }`
        : `CAP write action /${actionName} failed (HTTP ${resp.status}): ${capMsg}`
    );
    err.statusCode = resp.status;
    err.code = resp.status === 403 ? "CAP_FORBIDDEN" : "CAP_ACTION_ERROR";
    err.grantedScopes = grantedScopes;
    err.requiredScope = "RoleAdministrator";
    err.capResponse = parsedBody;
    throw err;
  }

  // CAP declares return type Edm.String (serialized backend response in { value: "..." })
  const rawEdmValue = parsedBody && typeof parsedBody === "object" && "value" in parsedBody ? parsedBody.value : parsedBody;
  let parsedResponse = rawEdmValue;
  if (typeof rawEdmValue === "string") {
    try {
      parsedResponse = JSON.parse(rawEdmValue);
    } catch {}
  }

  return {
    action: actionName,
    payload,
    grantedScopes,
    capResponse: rawEdmValue,
    parsedResponse,
  };
}

// 5c. Live 3-step Connection Verification for Add/Edit/Test System
export async function testSapConnection(input = {}) {
  const steps = [];
  const rawRoot = (input.serviceRoot || input.host || DEFAULT_CONFIG.baseUrl || "").trim().replace(/\/$/, "");
  const method = input.method || "OData API";
  const authType = input.authType || "OAuth 2.0 client credentials";
  const scopes = input.scopes || { roleData: true, userAssignments: false, writeActions: false };
  const endpoints = input.endpoints || {};

  if (method === "File upload") {
    return {
      steps: [
        { key: "reachable", label: "Reachable", ok: true },
        { key: "auth", label: "Authenticated", ok: true },
        { key: "techuser", label: "Technical user authorisations", ok: true },
      ],
      grantedScopes: [],
    };
  }

  // Step 1: Reachability check
  let serviceRoot = rawRoot;
  if (serviceRoot && !/^https?:\/\//i.test(serviceRoot)) {
    serviceRoot = `https://${serviceRoot}`;
  }

  const invalidHost = !serviceRoot || /fail|invalid/i.test(serviceRoot) || serviceRoot.length < 10;
  if (invalidHost) {
    steps.push({
      key: "reachable",
      label: "Reachable",
      ok: false,
      hint: "Enter a valid SAP CAP Service Root or OData endpoint URL (e.g. https://.../role-service).",
    });
    return { steps, grantedScopes: [] };
  }

  try {
    const metaUrl = serviceRoot.endsWith("/$metadata") ? serviceRoot : `${serviceRoot}/$metadata`;
    const pingResp = await fetch(metaUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    // HTTP 200, 401, or 403 proves the remote CAP/OData host is reachable over HTTPS
    const reachableOk = pingResp.status < 500;
    steps.push({
      key: "reachable",
      label: "Reachable",
      ok: reachableOk,
      hint: reachableOk
        ? undefined
        : `Endpoint ${metaUrl} responded with HTTP ${pingResp.status}. Verify Cloud Foundry app or SAP Gateway availability.`,
    });
    if (!reachableOk) return { steps, grantedScopes: [] };
  } catch (err) {
    steps.push({
      key: "reachable",
      label: "Reachable",
      ok: false,
      hint: `Cannot reach ${serviceRoot}: ${err.message}. Verify URL and network/Cloud Connector connectivity.`,
    });
    return { steps, grantedScopes: [] };
  }

  // Step 2: Authentication check
  let token = null;
  let grantedScopes = [];
  if (authType === "OAuth 2.0 client credentials") {
    const tokenUrl = (input.tokenUrl || DEFAULT_CONFIG.authTokenUrl || "").trim();
    const clientId = (input.clientId || DEFAULT_CONFIG.clientId || "").trim();
    const clientSecret = (input.clientSecret || DEFAULT_CONFIG.clientSecret || "").trim();

    if (!tokenUrl || !clientId || !clientSecret) {
      steps.push({
        key: "auth",
        label: "Authenticated",
        ok: false,
        hint: "Missing XSUAA Token URL, Client ID, or Client Secret.",
      });
      return { steps, grantedScopes };
    }

    try {
      const tokenInfo = await getXsuaaTokenInfo({ authTokenUrl: tokenUrl, clientId, clientSecret });
      token = tokenInfo.access_token;
      grantedScopes = String(tokenInfo.scope || "")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const hasAdminScope = grantedScopes.some((s) => s.includes("RoleAdministrator"));
      const authHint =
        scopes.writeActions && !hasAdminScope
          ? `Authenticated, but token scopes (${grantedScopes.join(", ") || "uaa.resource"}) do not include 'RoleAdministrator' required for write actions (createRole/assignRoleToUser).`
          : undefined;

      steps.push({
        key: "auth",
        label: "Authenticated",
        ok: Boolean(token),
        hint: authHint,
      });
    } catch (err) {
      steps.push({
        key: "auth",
        label: "Authenticated",
        ok: false,
        hint: err.message,
      });
      return { steps, grantedScopes };
    }
  } else if (authType === "Basic") {
    if (!input.technicalUser || !input.clientSecret) {
      steps.push({
        key: "auth",
        label: "Authenticated",
        ok: false,
        hint: "Technical user and password are required for Basic authentication.",
      });
      return { steps, grantedScopes };
    }
    token = Buffer.from(`${input.technicalUser}:${input.clientSecret}`).toString("base64");
    steps.push({ key: "auth", label: "Authenticated", ok: true });
  } else {
    steps.push({ key: "auth", label: "Authenticated", ok: true });
  }

  // Step 3: Endpoint / Technical User Authorisation check (Role API + optional User Assignments API)
  const authHeader =
    authType === "OAuth 2.0 client credentials" && token
      ? { Authorization: `Bearer ${token}` }
      : authType === "Basic" && token
        ? { Authorization: `Basic ${token}` }
        : {};

  const endpointErrors = [];
  if (scopes.roleData !== false) {
    const roleEp = (endpoints.roleHeaders || "RoleHeaders").replace(/^\//, "");
    try {
      const rResp = await fetch(`${serviceRoot}/${roleEp}?$top=1`, {
        headers: { ...authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!rResp.ok) {
        endpointErrors.push(`Role endpoint /${roleEp} returned HTTP ${rResp.status}`);
      }
    } catch (err) {
      endpointErrors.push(`Role endpoint /${roleEp} error: ${err.message}`);
    }
  }

  if (scopes.userAssignments) {
    const userEp = (endpoints.userAssignments || "RoleUserAssignments").replace(/^\//, "");
    try {
      const uResp = await fetch(`${serviceRoot}/${userEp}?$top=1`, {
        headers: { ...authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!uResp.ok) {
        endpointErrors.push(`User assignment endpoint /${userEp} returned HTTP ${uResp.status} (check ZGW_ROLES_MANAGEMENT_SRV availability)`);
      }
    } catch (err) {
      endpointErrors.push(`User assignment endpoint /${userEp} error: ${err.message}`);
    }
  }

  steps.push({
    key: "techuser",
    label: "Technical user authorisations",
    ok: endpointErrors.length === 0,
    hint: endpointErrors.length > 0 ? endpointErrors.join(" · ") : undefined,
  });

  return { steps, grantedScopes };
}

let isSyncInProgress = false;

export function getSyncLockStatus() {
  return isSyncInProgress;
}

// 6. Master Synchronization Function (Steps 1 to 8 Sequence)
export async function masterSync(pool, options = {}) {
  if (isSyncInProgress) {
    const err = new Error("A synchronization job is already running. Parallel sync executions are blocked.");
    err.code = "SYNC_IN_PROGRESS";
    throw err;
  }

  isSyncInProgress = true;
  const startedAt = new Date().toISOString();
  const systemId = options.systemId || "HMF-100";
  const systemName = options.systemName || "HMF 2023 – SAP S/4HANA (BTP CAP)";
  const syncType = options.syncType === "Delta" ? "Delta" : "Full";
  const scopes = options.scopes || { roleData: true, userAssignments: false };
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...(options.config || {}),
    baseUrl: options.baseUrl || options.config?.baseUrl || DEFAULT_CONFIG.baseUrl,
  };
  const syncOpts = { ...options, baseUrl: mergedConfig.baseUrl };

  console.log(`\n================ MASTER SYNC STARTED (${startedAt}) [${systemId}] ================`);

  let statusId = null;
  const client = await pool.connect();
  try {
    const sRes = await client.query(`
      INSERT INTO "SyncStatus" ("startedAt", "status", "systemId", "systemName", "syncType")
      VALUES ($1, 'In Progress', $2, $3, $4)
      RETURNING id
    `, [startedAt, systemId, systemName, syncType]);
    statusId = sRes.rows[0].id;
  } finally {
    client.release();
  }

  const results = {
    headers: { count: 0, status: scopes.roleData !== false ? "Pending" : "Skipped", error: null },
    auths: { count: 0, status: scopes.roleData !== false ? "Pending" : "Skipped", error: null },
    orgData: { count: 0, status: scopes.roleData !== false ? "Pending" : "Skipped", error: null },
    tcodes: { count: 0, status: scopes.roleData !== false ? "Pending" : "Skipped", error: null },
    userAssignments: { count: 0, status: scopes.userAssignments ? "Pending" : "Skipped", error: null },
  };

  try {
    // 1. Acquire XSUAA OAuth2 Token
    const token = await getXsuaaToken(mergedConfig);

    if (scopes.roleData !== false) {
      const headerMaxPages = options.maxPagesHeaders || (syncType === "Full" ? 60 : 5);
      // Step 1: RoleHeaders (with ManagementHeaders catalog fallback)
      try {
        results.headers.count = await syncRoleHeaders(pool, token, { ...syncOpts, maxPages: headerMaxPages });
        results.headers.status = "Success";
      } catch (e) {
        console.error("[MASTER SYNC] RoleHeaders failed:", e.message);
        try {
          console.log("[MASTER SYNC] Attempting ManagementHeaders catalog fallback...");
          results.headers.count = await syncRoleHeaders(pool, token, {
            ...syncOpts,
            maxPages: 1,
            endpoints: { ...(syncOpts.endpoints || {}), roleHeaders: "ManagementHeaders" },
          });
          results.headers.status = "Success";
        } catch (fallbackErr) {
          results.headers.status = "Failed";
          results.headers.error = `${e.message} (fallback: ${fallbackErr.message})`;
        }
      }

      // Step 2: RoleAuthorizations (uses direct v1.0 endpoint; skips timing-out ManagementAuthorizations)
      try {
        results.auths.count = await syncRoleAuthorizations(pool, token, syncOpts);
        results.auths.status = "Success";
      } catch (e) {
        console.error("[MASTER SYNC] RoleAuthorizations failed:", e.message);
        results.auths.status = "Failed";
        results.auths.error = e.message;
      }

      // Step 3: RoleOrgData
      try {
        results.orgData.count = await syncRoleOrgData(pool, token, syncOpts);
        results.orgData.status = "Success";
      } catch (e) {
        console.error("[MASTER SYNC] RoleOrgData failed:", e.message);
        results.orgData.status = "Failed";
        results.orgData.error = e.message;
      }

      // Step 4: RoleTCodes (note: returns 0 rows cleanly on HMF_2023)
      try {
        results.tcodes.count = await syncRoleTCodes(pool, token, syncOpts);
        results.tcodes.status = "Success";
      } catch (e) {
        console.error("[MASTER SYNC] RoleTCodes failed:", e.message);
        results.tcodes.status = "Failed";
        results.tcodes.error = e.message;
      }
    }

    // Step 5: Optional RoleUserAssignments (v1.2 ZGW_ROLES_MANAGEMENT_SRV)
    if (scopes.userAssignments) {
      try {
        results.userAssignments.count = await syncRoleUserAssignments(pool, token, syncOpts);
        results.userAssignments.status = "Success";
      } catch (e) {
        console.error("[MASTER SYNC] RoleUserAssignments failed:", e.message);
        results.userAssignments.status = "Failed";
        results.userAssignments.error = e.message;
      }
    }

    const completedAt = new Date().toISOString();
    const activeSteps = Object.values(results).filter((r) => r.status !== "Skipped");
    const hasFailures = activeSteps.some((r) => r.status === "Failed");
    const allFailed = activeSteps.length > 0 && activeSteps.every((r) => r.status === "Failed");
    const overallStatus = allFailed ? "Failed" : (hasFailures ? "Partial Success" : "Success");

    const failedCount = activeSteps.filter((r) => r.status === "Failed").length;
    const errorDetails = hasFailures
      ? JSON.stringify(Object.fromEntries(Object.entries(results).filter(([_, v]) => v.error)))
      : null;

    const durationSec = Math.max(1, Math.round((new Date(completedAt) - new Date(startedAt)) / 1000));
    const totalRecs = results.headers.count + results.userAssignments.count;
    const syncMsg = `Master synchronization: ${results.headers.count.toLocaleString()} roles, ${results.auths.count.toLocaleString()} auths, ${results.userAssignments.count.toLocaleString()} user assignments loaded`;

    const uClient = await pool.connect();
    try {
      await uClient.query(`
        UPDATE "SyncStatus"
        SET "completedAt" = $1,
            "status" = $2,
            "headersProcessed" = $3,
            "authsProcessed" = $4,
            "orgDataProcessed" = $5,
            "tcodesProcessed" = $6,
            "userAssignmentsProcessed" = $7,
            "failedRecords" = $8,
            "errorMessage" = $9,
            "syncType" = $10,
            "systemId" = $11,
            "systemName" = $12,
            "records" = $13,
            "durationSec" = $14,
            "message" = $15
        WHERE id = $16
      `, [
        completedAt,
        overallStatus,
        results.headers.count,
        results.auths.count,
        results.orgData.count,
        results.tcodes.count,
        results.userAssignments.count,
        failedCount,
        errorDetails,
        syncType,
        systemId,
        systemName,
        totalRecs,
        durationSec,
        syncMsg,
        statusId,
      ]);

      await uClient.query(`
        UPDATE "SapSystems"
        SET "lastDeltaSync" = $1,
            "lastFullSync" = CASE WHEN $2 = 'Full' THEN $1 ELSE "lastFullSync" END,
            "status" = $3,
            "statusMessage" = $4,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $5
      `, [
        completedAt,
        syncType,
        overallStatus === "Failed" ? "Failed" : (overallStatus === "Partial Success" ? "Warning" : "Connected"),
        hasFailures ? `Partial sync warning: check sync history` : null,
        systemId,
      ]);
    } finally {
      uClient.release();
    }

    console.log(`================ MASTER SYNC COMPLETED (${overallStatus}) ================`);
    return {
      success: overallStatus !== "Failed",
      status: overallStatus,
      startedAt,
      completedAt,
      durationSec,
      records: totalRecs,
      message: syncMsg,
      details: results,
    };
  } catch (fatalErr) {
    console.error("[FATAL MASTER SYNC ERROR]:", fatalErr.message);
    if (statusId) {
      const eClient = await pool.connect();
      try {
        await eClient.query(`
          UPDATE "SyncStatus"
          SET "completedAt" = CURRENT_TIMESTAMP,
              "status" = 'Failed',
              "errorMessage" = $1
          WHERE id = $2
        `, [fatalErr.message, statusId]);
      } catch {}
      finally {
        eClient.release();
      }
    }
    throw fatalErr;
  } finally {
    isSyncInProgress = false;
  }
}

