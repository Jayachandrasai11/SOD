import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

export function getGeminiApiKey() {
  const key = process.env.Gemini_API_key || process.env.GEMINI_API_KEY || process.env.gemini_api_key || "";
  return key.trim();
}

/**
 * Initialize pgvector extension and FioriAppCatalog table with 768-dim vector embeddings
 */
export async function initFioriVectorDb(client) {
  try {
    // 1. Enable pgvector extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log("[DB] pgvector extension verified / initialized.");

    // 2. Create FioriAppCatalog table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "FioriAppCatalog" (
        "AppId" VARCHAR(60) PRIMARY KEY,
        "TCode" VARCHAR(30) NOT NULL,
        "AppName" VARCHAR(180),
        "OneLineDescription" TEXT,
        "ActionCategory" VARCHAR(20) DEFAULT 'PENDING',
        "FioriLibraryUrl" TEXT,
        "Embedding" vector(768),
        "Status" VARCHAR(30) DEFAULT 'Extracted',
        "RoleCount" INT DEFAULT 1,
        "SampleRoles" TEXT[],
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS "idx_fiori_status" ON "FioriAppCatalog"("Status");
      CREATE INDEX IF NOT EXISTS "idx_fiori_category" ON "FioriAppCatalog"("ActionCategory");
      CREATE INDEX IF NOT EXISTS "idx_fiori_tcode" ON "FioriAppCatalog"("TCode");
    `);

    // 3. Create HNSW Cosine Index for pgvector
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS "idx_fiori_embedding_hnsw" 
        ON "FioriAppCatalog" 
        USING hnsw ("Embedding" vector_cosine_ops);
      `);
      console.log("[DB] HNSW cosine vector index verified.");
    } catch (idxErr) {
      console.warn("[DB] Note on HNSW index:", idxErr.message);
    }
  } catch (err) {
    console.error("[DB ERROR] initFioriVectorDb failed:", err.message);
    throw err;
  }
}

/**
 * Step 1: Extract distinct T-Codes & Fiori Apps from RoleAuthorizations ("Auth Details" table)
 * and persist them into the FioriAppCatalog table.
 */
export async function extractAuthApps(pool) {
  const query = `
    SELECT 
      TRIM("Low") AS "tcode",
      COUNT(DISTINCT "AgrName")::int AS "roleCount",
      (array_agg(DISTINCT "AgrName"))[1:5] AS "sampleRoles"
    FROM "RoleAuthorizations"
    WHERE "Low" IS NOT NULL 
      AND TRIM("Low") != '' 
      AND "Low" != '*'
      AND ("Field" = 'TCD' OR "Object" IN ('S_TCODE', 'S_START', '/UI2/CHIP'))
    GROUP BY TRIM("Low")
    ORDER BY "roleCount" DESC;
  `;

  const { rows } = await pool.query(query);
  console.log(`[FIORI EXTRACT] Found ${rows.length} distinct apps/t-codes from RoleAuthorizations.`);

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const tcode = row.tcode.toUpperCase();
    const roleCount = row.roleCount || 1;
    const sampleRoles = row.sampleRoles || [];

    const upsertRes = await pool.query(`
      INSERT INTO "FioriAppCatalog" (
        "AppId", "TCode", "RoleCount", "SampleRoles", "Status", "ActionCategory",
        "FioriLibraryUrl"
      ) VALUES ($1, $2, $3, $4, 'Extracted', 'PENDING', $5)
      ON CONFLICT ("AppId") DO UPDATE SET
        "RoleCount" = EXCLUDED."RoleCount",
        "SampleRoles" = EXCLUDED."SampleRoles",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING (xmax = 0) AS is_insert;
    `, [
      tcode,
      tcode,
      roleCount,
      sampleRoles,
      `https://fioriappslibrary.hana.ondemand.com`
    ]);

    if (upsertRes.rows[0]?.is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  const totalRes = await pool.query(`SELECT COUNT(*)::int AS count FROM "FioriAppCatalog"`);
  return {
    totalExtracted: rows.length,
    newInserted: inserted,
    existingUpdated: updated,
    totalCatalogApps: totalRes.rows[0]?.count || rows.length
  };
}

/**
 * Step 2: Call Gemini LLM (gemini-2.5-flash) with the prompt:
 * "Using the Fiori app id and tcode in Low field of Auth detail, create one line description
 * of what the app does. refer to https://fioriappslibrary.hana.ondemand.com add a column
 * whether the app supports Create, Update, Delete or just read only. This data will be stored
 * in a vector database."
 */
export async function callGeminiEnrichment(appData) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured in server/.env (Gemini_API_key)");
  }

  const textUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `You are an SAP S/4HANA & SAP Fiori Solutions Architect and Security Specialist.
Task:
Using the Fiori app id and tcode in Low field of Auth detail, create one line description of what the app does. Refer to https://fioriappslibrary.hana.ondemand.com. Add whether the app supports Create, Update, Delete or just read only. This data will be stored in a vector database.

App Details:
- T-Code / Low field: "${appData.TCode || appData.AppId}"
- Associated SAP Roles: ${(appData.SampleRoles || []).join(", ") || "SAP standard roles"}

Instructions:
1. Provide a concise, clear one-line description of what this application does in SAP S/4HANA, referencing standard business tasks.
2. Determine its primary action capability:
   - "CREATE" if the primary purpose is creating new master/transactional records (e.g. ME21N, VA01, FB50, BP create).
   - "UPDATE" if the primary purpose is modifying, changing, processing, posting, or maintaining existing records (e.g. ME22N, VA02, FB02).
   - "DELETE" if the primary purpose is deletion, cancellation, or archiving (e.g. ME28 cancellation, mass deletion).
   - "READ_ONLY" if the application is for display, inquiry, reporting, or list viewing only (e.g. ME23N, VA03, FB03, SE16N read).
3. Provide the accurate SAP Fiori App Name and official Fiori Apps Reference Library link.
4. Output strictly valid JSON matching this schema:
{
  "appId": "${appData.AppId}",
  "tcode": "${appData.TCode || appData.AppId}",
  "appName": "Exact SAP App / Transaction Name",
  "oneLineDescription": "One line description of what the app does referencing business functionality.",
  "actionCategory": "CREATE | UPDATE | DELETE | READ_ONLY",
  "fioriLibraryUrl": "https://fioriappslibrary.hana.ondemand.com"
}`;

  const resultJson = await callGeminiWithFallback(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    },
    25000
  );
  const rawText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("No text returned by Gemini LLM");
  }

  const parsed = JSON.parse(rawText);
  // Normalize actionCategory
  let actionCategory = String(parsed.actionCategory || "").toUpperCase().trim();
  if (!["CREATE", "UPDATE", "DELETE", "READ_ONLY"].includes(actionCategory)) {
    if (actionCategory.includes("CREATE")) actionCategory = "CREATE";
    else if (actionCategory.includes("DELETE")) actionCategory = "DELETE";
    else if (actionCategory.includes("UPDATE") || actionCategory.includes("CHANGE")) actionCategory = "UPDATE";
    else actionCategory = "READ_ONLY";
  }

  return {
    appId: parsed.appId || appData.AppId,
    tcode: parsed.tcode || appData.TCode,
    appName: parsed.appName || appData.TCode,
    oneLineDescription: parsed.oneLineDescription || "",
    actionCategory,
    fioriLibraryUrl: parsed.fioriLibraryUrl || "https://fioriappslibrary.hana.ondemand.com"
  };
}

/**
 * Step 3: Generate 768-dimensional Vector Embedding with gemini-embedding-001
 */
export async function generateEmbedding(textToEmbed) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is missing");
  }

  const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;

  const resp = await fetch(embedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: textToEmbed }] },
      outputDimensionality: 768
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini Embedding error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const vector = data.embedding?.values;
  if (!vector || !Array.isArray(vector) || vector.length !== 768) {
    throw new Error(`Invalid vector received from Gemini embedding. Dimension: ${vector?.length}`);
  }

  return vector;
}

/**
 * Enrich apps with LLM & Save into pgvector
 */
export async function enrichAppsBatch(pool, options = {}) {
  const { limit = 10, appIds = null, forceReenrich = false } = options;

  let query = `
    SELECT "AppId", "TCode", "AppName", "OneLineDescription", "ActionCategory", "RoleCount", "SampleRoles", "Status"
    FROM "FioriAppCatalog"
  `;
  const params = [];

  if (Array.isArray(appIds) && appIds.length > 0) {
    query += ` WHERE "AppId" = ANY($1)`;
    params.push(appIds);
  } else if (!forceReenrich) {
    query += ` WHERE "Status" = 'Extracted' OR "Embedding" IS NULL`;
  }

  query += ` ORDER BY "RoleCount" DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  console.log(`[ENRICHMENT] Processing ${rows.length} apps with Gemini LLM + pgvector...`);

  const results = [];
  let successCount = 0;
  let errorCount = 0;

  for (const app of rows) {
    try {
      // 1. Call LLM for description and CRUD action category
      const enriched = await callGeminiEnrichment(app);

      // 2. Compute 768-dim vector embedding on the semantic description + app context
      const embeddingText = `${enriched.tcode} ${enriched.appName}: ${enriched.oneLineDescription} [Action: ${enriched.actionCategory}]`;
      const vector = await generateEmbedding(embeddingText);

      // 3. Format vector as PostgreSQL vector string: '[0.0123,-0.0456,...]'
      const vectorStr = `[${vector.join(",")}]`;

      // 4. Update FioriAppCatalog with vector embedding in PostgreSQL
      await pool.query(`
        UPDATE "FioriAppCatalog"
        SET 
          "AppName" = $1,
          "OneLineDescription" = $2,
          "ActionCategory" = $3,
          "FioriLibraryUrl" = $4,
          "Embedding" = $5::vector,
          "Status" = 'Enriched',
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "AppId" = $6
      `, [
        enriched.appName,
        enriched.oneLineDescription,
        enriched.actionCategory,
        enriched.fioriLibraryUrl,
        vectorStr,
        app.AppId
      ]);

      successCount++;
      results.push({
        appId: app.AppId,
        tcode: enriched.tcode,
        appName: enriched.appName,
        oneLineDescription: enriched.oneLineDescription,
        actionCategory: enriched.actionCategory,
        fioriLibraryUrl: enriched.fioriLibraryUrl,
        status: "Enriched",
        hasVector: true
      });
    } catch (appErr) {
      errorCount++;
      console.error(`[ENRICH ERROR] Failed for ${app.AppId}:`, appErr.message);
      results.push({
        appId: app.AppId,
        status: "Failed",
        error: appErr.message
      });
    }
  }

  return {
    processed: rows.length,
    successCount,
    errorCount,
    results
  };
}

/**
 * Natural language semantic search using pgvector cosine distance:
 * 1 - ("Embedding" <=> queryVector) = Cosine Similarity
 */
export async function semanticSearchFiori(pool, searchQuery, limit = 0, minSimilarity = 0.45) {
  if (!searchQuery || !searchQuery.trim()) {
    return [];
  }

  // 1. Embed user query using Gemini
  const queryVector = await generateEmbedding(searchQuery.trim());
  const vectorStr = `[${queryVector.join(",")}]`;

  // 2. Perform Cosine Similarity vector search in PostgreSQL (returns all matches above threshold when limit <= 0)
  const hasLimit = Number(limit) > 0;
  const params = hasLimit ? [vectorStr, Number(limit)] : [vectorStr, Number(minSimilarity)];
  const searchSql = hasLimit
    ? `
      SELECT 
        "AppId", "TCode", "AppName", "OneLineDescription", "ActionCategory", 
        "FioriLibraryUrl", "RoleCount", "SampleRoles", "Status",
        ("Embedding" IS NOT NULL) AS "hasVector",
        ROUND((1 - ("Embedding" <=> $1::vector))::numeric, 4) AS "similarity"
      FROM "FioriAppCatalog"
      WHERE "Embedding" IS NOT NULL
      ORDER BY "Embedding" <=> $1::vector ASC
      LIMIT $2;
    `
    : `
      SELECT 
        "AppId", "TCode", "AppName", "OneLineDescription", "ActionCategory", 
        "FioriLibraryUrl", "RoleCount", "SampleRoles", "Status",
        ("Embedding" IS NOT NULL) AS "hasVector",
        ROUND((1 - ("Embedding" <=> $1::vector))::numeric, 4) AS "similarity"
      FROM "FioriAppCatalog"
      WHERE "Embedding" IS NOT NULL
        AND (1 - ("Embedding" <=> $1::vector)) >= $2
      ORDER BY "Embedding" <=> $1::vector ASC;
    `;

  const { rows } = await pool.query(searchSql, params);
  return rows.map(r => ({
    ...r,
    similarity: parseFloat(r.similarity) || 0
  }));
}

/**
 * Query catalog list with pagination, search, and category filters
 */
export async function getFioriCatalog(pool, options = {}) {
  const {
    page = 1,
    pageSize = 15,
    search = "",
    category = "ALL",
    status = "ALL",
    sortBy = "RoleCount",
    sortDir = "DESC"
  } = options;

  const validSortCols = {
    RoleCount: `"RoleCount"`,
    AppId: `"AppId"`,
    AppName: `"AppName"`,
    ActionCategory: `"ActionCategory"`,
    Status: `"Status"`,
    updatedAt: `"updatedAt"`
  };
  const sortCol = validSortCols[sortBy] || `"RoleCount"`;
  const orderDir = sortDir.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const conditions = [];
  const params = [];

  if (category && category !== "ALL") {
    params.push(category.toUpperCase());
    conditions.push(`"ActionCategory" = $${params.length}`);
  }

  if (status && status !== "ALL") {
    params.push(status);
    conditions.push(`"Status" = $${params.length}`);
  }

  if (search && search.trim() !== "") {
    params.push(`%${search.trim().toLowerCase()}%`);
    const pIdx = params.length;
    conditions.push(`(
      LOWER("AppId") LIKE $${pIdx} OR 
      LOWER("TCode") LIKE $${pIdx} OR 
      LOWER(COALESCE("AppName", '')) LIKE $${pIdx} OR 
      LOWER(COALESCE("OneLineDescription", '')) LIKE $${pIdx}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total matching
  const countSql = `SELECT COUNT(*)::int AS total FROM "FioriAppCatalog" ${whereClause}`;
  const countRes = await pool.query(countSql, params);
  const total = countRes.rows[0]?.total || 0;

  // Pagination query
  const offset = (Math.max(1, page) - 1) * pageSize;
  const listSql = `
    SELECT 
      "AppId", "TCode", "AppName", "OneLineDescription", "ActionCategory", 
      "FioriLibraryUrl", "RoleCount", "SampleRoles", "Status",
      ("Embedding" IS NOT NULL) AS "hasVector",
      "createdAt", "updatedAt"
    FROM "FioriAppCatalog"
    ${whereClause}
    ORDER BY ${sortCol} ${orderDir}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const listParams = [...params, pageSize, offset];
  const listRes = await pool.query(listSql, listParams);

  return {
    total,
    page: Math.max(1, page),
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    data: listRes.rows
  };
}

/**
 * Summary Stats for the UI Dashboard Cards
 */
export async function getFioriStats(pool) {
  const q = `
    SELECT 
      COUNT(*)::int AS "totalApps",
      COUNT(*) FILTER (WHERE "Status" = 'Enriched')::int AS "enrichedCount",
      COUNT(*) FILTER (WHERE "Status" = 'Extracted' OR "Embedding" IS NULL)::int AS "pendingCount",
      COUNT(*) FILTER (WHERE "ActionCategory" = 'CREATE')::int AS "createCount",
      COUNT(*) FILTER (WHERE "ActionCategory" = 'UPDATE')::int AS "updateCount",
      COUNT(*) FILTER (WHERE "ActionCategory" = 'DELETE')::int AS "deleteCount",
      COUNT(*) FILTER (WHERE "ActionCategory" = 'READ_ONLY')::int AS "readOnlyCount",
      COUNT(*) FILTER (WHERE "Embedding" IS NOT NULL)::int AS "vectorCount"
    FROM "FioriAppCatalog";
  `;

  const { rows } = await pool.query(q);
  return rows[0] || {
    totalApps: 0,
    enrichedCount: 0,
    pendingCount: 0,
    createCount: 0,
    updateCount: 0,
    deleteCount: 0,
    readOnlyCount: 0,
    vectorCount: 0
  };
}

// =====================================================================
// CHUNKED BACKGROUND ENRICHMENT PIPELINE (Copy -> Gemini -> pgvector)
// =====================================================================

function normalizeActionCategory(raw) {
  const val = String(raw || "").toUpperCase().trim();
  if (["CREATE", "UPDATE", "DELETE", "READ_ONLY"].includes(val)) return val;
  if (val.includes("CREATE")) return "CREATE";
  if (val.includes("DELETE")) return "DELETE";
  if (val.includes("UPDATE") || val.includes("CHANGE") || val.includes("MAINTAIN")) return "UPDATE";
  return "READ_ONLY";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ordered by highest free-tier quota & speed -> fallback models
const GEMINI_TEXT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];
const exhaustedModels = new Set();

async function fetchWithRetry(url, fetchOptions, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    const resp = await fetch(url, fetchOptions);
    if (resp.ok) return resp;

    const errText = await resp.text();
    const isDailyQuota =
      resp.status === 429 &&
      (errText.includes("PerDay") ||
        errText.includes("generate_content_free_tier_requests") ||
        errText.includes("limit: 20"));

    // Do not waste time retrying daily quota exhaustion on the same model
    if (isDailyQuota) {
      const err = new Error(`HTTP 429 Daily Quota: ${errText.slice(0, 300)}`);
      err.status = 429;
      err.isDailyQuota = true;
      throw err;
    }

    if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
      attempt++;
      const delayMs = 2000 * Math.pow(2, attempt - 1);
      console.warn(`[GEMINI RETRY] HTTP ${resp.status}. Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
      await sleep(delayMs);
      continue;
    }

    const err = new Error(`HTTP ${resp.status}: ${errText.slice(0, 400)}`);
    err.status = resp.status;
    throw err;
  }
}

/**
 * Call Gemini generateContent with automatic model rotation on 429 quota limits
 */
async function callGeminiWithFallback(bodyPayload, timeoutMs = 45000) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured in server/.env (Gemini_API_key)");
  }

  let lastErr = null;
  for (const model of GEMINI_TEXT_MODELS) {
    if (exhaustedModels.has(model)) continue;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const resp = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return await resp.json();
    } catch (err) {
      lastErr = err;
      if (err.status === 429) {
        console.warn(`[GEMINI FALLBACK] Model ${model} hit 429 quota/rate limit. Switching to next model...`);
        if (err.isDailyQuota) exhaustedModels.add(model);
        continue;
      }
      throw err;
    }
  }

  const quotaErr = new Error(
    `All Gemini fallback models hit quota limits (${lastErr?.message || "HTTP 429"}). Completed progress is saved — please wait or check billing.`
  );
  quotaErr.isQuotaExhausted = true;
  throw quotaErr;
}

/**
 * Enrich a chunk of up to 35-50 SAP apps in a single Gemini call
 */
export async function callGeminiEnrichmentChunk(appsChunk) {
  const appListText = appsChunk
    .map((a, i) => `${i + 1}. AppId/TCode: "${a.AppId}" | SampleRoles: ${(a.SampleRoles || []).slice(0, 3).join(", ") || "Standard"}`)
    .join("\n");

  const prompt = `You are an SAP S/4HANA & SAP Fiori Solutions Architect and Security Specialist.
Task:
Using the Fiori app id and tcode in Low field of Auth detail, create one line description of what each app does. Refer to https://fioriappslibrary.hana.ondemand.com. Add whether each app supports Create, Update, Delete or just read only. This data will be stored in a vector database.

Analyze ALL ${appsChunk.length} items below:
${appListText}

Instructions:
1. Return a JSON array with one object per input item, preserving the exact "appId" string.
2. For each item:
   - "appName": Concise SAP App / Transaction Name
   - "oneLineDescription": Clear one-line description of what the app does in SAP S/4HANA.
   - "actionCategory": Must be strictly one of "CREATE", "UPDATE", "DELETE", "READ_ONLY".
   - "fioriLibraryUrl": Official Fiori Apps Reference Library URL (e.g. "https://fioriappslibrary.hana.ondemand.com").

Output strictly valid JSON matching this schema:
[
  {
    "appId": "EXACT_INPUT_APPID",
    "appName": "App Name",
    "oneLineDescription": "One line description.",
    "actionCategory": "CREATE",
    "fioriLibraryUrl": "https://fioriappslibrary.hana.ondemand.com"
  }
]`;

  const resultJson = await callGeminiWithFallback(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    },
    45000
  );
  const rawText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Empty response returned by Gemini LLM for chunk");
  }

  const parsed = JSON.parse(rawText);
  const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.apps || []);

  // Index by AppId for deterministic lookup
  const byId = new Map();
  for (const item of items) {
    if (item && item.appId) {
      byId.set(String(item.appId).trim().toUpperCase(), {
        appId: String(item.appId).trim().toUpperCase(),
        appName: item.appName || item.appId,
        oneLineDescription: item.oneLineDescription || "",
        actionCategory: normalizeActionCategory(item.actionCategory),
        fioriLibraryUrl: item.fioriLibraryUrl || "https://fioriappslibrary.hana.ondemand.com"
      });
    }
  }
  return byId;
}

/**
 * Generate 768-dim vector embeddings for an entire chunk in 1 HTTP call using batchEmbedContents
 */
export async function generateBatchEmbeddings(texts) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is missing");
  }

  const batchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`;

  const requests = texts.map((text) => ({
    model: "models/gemini-embedding-001",
    content: { parts: [{ text }] },
    outputDimensionality: 768
  }));

  const resp = await fetchWithRetry(batchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30000)
  });

  const data = await resp.json();
  const embeddings = data.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Batch embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`);
  }

  return embeddings.map((e) => e.values);
}

// Background Job State (singleton for single-node server)
const chunkJobState = {
  jobId: null,
  status: "idle", // idle | running | completed | cancelled | failed
  phase: "idle",  // idle | copying | enriching | done
  totalToProcess: 0,
  processedCount: 0,
  successCount: 0,
  errorCount: 0,
  currentChunk: 0,
  totalChunks: 0,
  chunkSize: 15,
  copiedStats: null,
  startedAt: null,
  updatedAt: null,
  completedAt: null,
  lastError: null,
  recentErrors: [],
  cancelRequested: false
};

export function getChunkedJobStatus() {
  const { cancelRequested, ...publicState } = chunkJobState;
  return { ...publicState };
}

export function cancelChunkedJob() {
  if (chunkJobState.status !== "running") {
    return { cancelled: false, message: "No chunked enrichment job is currently running.", state: getChunkedJobStatus() };
  }
  chunkJobState.cancelRequested = true;
  chunkJobState.updatedAt = new Date().toISOString();
  return { cancelled: true, message: "Cancellation requested; stopping after current chunk.", state: getChunkedJobStatus() };
}

/**
 * Start non-blocking background job:
 * 1. Copy distinct apps/T-Codes from RoleAuthorizations -> FioriAppCatalog
 * 2. Chunk pending apps (default 15 per Gemini call) + batchEmbedContents -> save to pgvector
 */
export function startChunkedEnrichJob(pool, options = {}) {
  if (chunkJobState.status === "running") {
    return { started: false, alreadyRunning: true, state: getChunkedJobStatus() };
  }

  const chunkSize = Math.min(Math.max(parseInt(options.chunkSize, 10) || 25, 1), 50);
  // Default to safe batch cap of 100 apps per run to stay well within Gemini quota (pass 0 for unlimited)
  const parsedMax = options.maxApps !== undefined && options.maxApps !== null ? parseInt(options.maxApps, 10) : 100;
  const maxApps = parsedMax > 0 ? parsedMax : null;
  const forceReenrich = Boolean(options.forceReenrich);
  const copyFirst = options.copyFirst !== false;

  const jobId = `FIORI-JOB-${Date.now()}`;
  Object.assign(chunkJobState, {
    jobId,
    status: "running",
    phase: copyFirst ? "copying" : "enriching",
    totalToProcess: 0,
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    currentChunk: 0,
    totalChunks: 0,
    chunkSize,
    copiedStats: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    lastError: null,
    recentErrors: [],
    cancelRequested: false
  });

  // Run asynchronously so HTTP request returns immediately (202 Accepted)
  (async () => {
    try {
      // Step 1: Copy latest synced RoleAuthorizations -> FioriAppCatalog
      if (copyFirst) {
        chunkJobState.phase = "copying";
        chunkJobState.updatedAt = new Date().toISOString();
        const extractStats = await extractAuthApps(pool);
        chunkJobState.copiedStats = extractStats;
        console.log(`[CHUNK JOB ${jobId}] Copied/verified ${extractStats.totalExtracted} apps from RoleAuthorizations.`);
      }

      if (chunkJobState.cancelRequested) {
        chunkJobState.status = "cancelled";
        chunkJobState.phase = "done";
        chunkJobState.completedAt = new Date().toISOString();
        return;
      }

      // Step 2: Fetch pending apps (or all if forceReenrich)
      chunkJobState.phase = "enriching";
      let sql = `
        SELECT "AppId", "TCode", "SampleRoles", "RoleCount"
        FROM "FioriAppCatalog"
      `;
      if (!forceReenrich) {
        sql += ` WHERE "Status" != 'Enriched' OR "Embedding" IS NULL`;
      }
      sql += ` ORDER BY "RoleCount" DESC`;
      if (maxApps && maxApps > 0) {
        sql += ` LIMIT ${maxApps}`;
      }

      const { rows: pendingApps } = await pool.query(sql);
      chunkJobState.totalToProcess = pendingApps.length;
      chunkJobState.totalChunks = Math.ceil(pendingApps.length / chunkSize);
      chunkJobState.updatedAt = new Date().toISOString();

      if (pendingApps.length === 0) {
        chunkJobState.status = "completed";
        chunkJobState.phase = "done";
        chunkJobState.completedAt = new Date().toISOString();
        console.log(`[CHUNK JOB ${jobId}] All apps already enriched & vectorized.`);
        return;
      }

      console.log(`[CHUNK JOB ${jobId}] Enriching ${pendingApps.length} apps in ${chunkJobState.totalChunks} chunks (size=${chunkSize}).`);

      // Step 3: Process chunk by chunk with checkpointing
      for (let i = 0; i < pendingApps.length; i += chunkSize) {
        if (chunkJobState.cancelRequested) {
          chunkJobState.status = "cancelled";
          chunkJobState.phase = "done";
          chunkJobState.completedAt = new Date().toISOString();
          console.log(`[CHUNK JOB ${jobId}] Cancelled by user at chunk ${chunkJobState.currentChunk}.`);
          return;
        }

        const chunk = pendingApps.slice(i, i + chunkSize);
        chunkJobState.currentChunk = Math.floor(i / chunkSize) + 1;
        chunkJobState.updatedAt = new Date().toISOString();

        try {
          // 3a. Call Gemini 2.5 Flash for the entire chunk
          const enrichedMap = await callGeminiEnrichmentChunk(chunk);

          // Match each app in chunk to its LLM output
          const readyItems = [];
          for (const app of chunk) {
            const key = String(app.AppId).trim().toUpperCase();
            const enriched = enrichedMap.get(key);
            if (enriched && enriched.oneLineDescription) {
              readyItems.push({ app, enriched });
            } else {
              chunkJobState.errorCount++;
              chunkJobState.processedCount++;
              chunkJobState.recentErrors = [
                `${app.AppId}: Missing from chunk LLM output`,
                ...chunkJobState.recentErrors
              ].slice(0, 10);
            }
          }

          if (readyItems.length > 0) {
            // 3b. Call Gemini batchEmbedContents for all ready items in 1 request
            const texts = readyItems.map(
              ({ app, enriched }) =>
                `${app.TCode || app.AppId} ${enriched.appName}: ${enriched.oneLineDescription} [Action: ${enriched.actionCategory}]`
            );
            const vectors = await generateBatchEmbeddings(texts);

            // 3c. Save chunk into PostgreSQL pgvector inside a transaction
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              for (let idx = 0; idx < readyItems.length; idx++) {
                const { app, enriched } = readyItems[idx];
                const vec = vectors[idx];
                if (!vec || vec.length !== 768) {
                  throw new Error(`Invalid vector length for ${app.AppId}`);
                }
                const vectorStr = `[${vec.join(",")}]`;
                await client.query(
                  `
                  UPDATE "FioriAppCatalog"
                  SET
                    "AppName" = $1,
                    "OneLineDescription" = $2,
                    "ActionCategory" = $3,
                    "FioriLibraryUrl" = $4,
                    "Embedding" = $5::vector,
                    "Status" = 'Enriched',
                    "updatedAt" = CURRENT_TIMESTAMP
                  WHERE "AppId" = $6
                  `,
                  [
                    enriched.appName,
                    enriched.oneLineDescription,
                    enriched.actionCategory,
                    enriched.fioriLibraryUrl,
                    vectorStr,
                    app.AppId
                  ]
                );
                chunkJobState.successCount++;
                chunkJobState.processedCount++;
              }
              await client.query("COMMIT");
            } catch (dbErr) {
              await client.query("ROLLBACK");
              throw dbErr;
            } finally {
              client.release();
            }
          }
        } catch (chunkErr) {
          console.error(`[CHUNK JOB ${jobId}] Chunk ${chunkJobState.currentChunk} failed:`, chunkErr.message);
          chunkJobState.errorCount += chunk.length;
          chunkJobState.processedCount += chunk.length;
          chunkJobState.lastError = chunkErr.message;
          chunkJobState.recentErrors = [
            `Chunk ${chunkJobState.currentChunk}: ${chunkErr.message}`,
            ...chunkJobState.recentErrors
          ].slice(0, 10);

          // Fail-fast if all fallback models hit quota limits instead of burning remaining chunks
          if (chunkErr.isQuotaExhausted) {
            chunkJobState.status = "failed";
            chunkJobState.phase = "done";
            chunkJobState.completedAt = new Date().toISOString();
            chunkJobState.updatedAt = chunkJobState.completedAt;
            console.warn(`[CHUNK JOB ${jobId}] Halted early due to Gemini quota exhaustion. Saved ${chunkJobState.successCount} apps.`);
            return;
          }
        }

        chunkJobState.updatedAt = new Date().toISOString();
        // Safe RPM pacing (4.5s between chunks = ~13 RPM max, under 15 RPM free-tier limit)
        if (i + chunkSize < pendingApps.length && !chunkJobState.cancelRequested) {
          await sleep(4500);
        }
      }

      chunkJobState.status = "completed";
      chunkJobState.phase = "done";
      chunkJobState.completedAt = new Date().toISOString();
      chunkJobState.updatedAt = chunkJobState.completedAt;
      console.log(`[CHUNK JOB ${jobId}] Completed! Success: ${chunkJobState.successCount}, Errors: ${chunkJobState.errorCount}`);
    } catch (fatalErr) {
      console.error(`[CHUNK JOB ${jobId}] Fatal error:`, fatalErr);
      chunkJobState.status = "failed";
      chunkJobState.phase = "done";
      chunkJobState.lastError = fatalErr.message;
      chunkJobState.completedAt = new Date().toISOString();
      chunkJobState.updatedAt = chunkJobState.completedAt;
    }
  })();

  return { started: true, alreadyRunning: false, state: getChunkedJobStatus() };
}

/**
 * Detailed view for a single Fiori App / T-Code:
 * 1. App record from FioriAppCatalog
 * 2. Roles using this app (RoleAuthorizations + RoleHeaders)
 * 3. Users with access via those roles (RoleUserAssignments)
 * 4. Authorization objects & fields (RoleAuthorizations)
 * 5. Semantically similar apps via pgvector cosine distance
 */
export async function getFioriAppDetail(pool, appId) {
  const cleanId = String(appId || "").trim().toUpperCase();
  if (!cleanId) return null;

  const appRes = await pool.query(
    `
    SELECT 
      "AppId", "TCode", "AppName", "OneLineDescription", "ActionCategory",
      "FioriLibraryUrl", "RoleCount", "SampleRoles", "Status",
      ("Embedding" IS NOT NULL) AS "hasVector",
      "createdAt", "updatedAt"
    FROM "FioriAppCatalog"
    WHERE UPPER("AppId") = $1 OR UPPER("TCode") = $1
    LIMIT 1;
    `,
    [cleanId]
  );

  if (appRes.rows.length === 0) {
    return null;
  }
  const app = appRes.rows[0];

  // 2. Roles granting this T-Code / Fiori App
  const rolesRes = await pool.query(
    `
    SELECT DISTINCT
      ra."AgrName",
      COALESCE(rh."Text", '') AS "RoleDesc",
      COALESCE(rh."RoleType", '') AS "RoleType",
      COALESCE(rh."ParentAgr", '') AS "ParentAgr"
    FROM "RoleAuthorizations" ra
    LEFT JOIN "RoleHeaders" rh ON rh."AgrName" = ra."AgrName"
    WHERE UPPER(TRIM(ra."Low")) = $1
      AND (ra."Field" = 'TCD' OR ra."Object" IN ('S_TCODE', 'S_START', '/UI2/CHIP'))
    ORDER BY ra."AgrName" ASC;
    `,
    [cleanId]
  );

  const roleNames = rolesRes.rows.map((r) => r.AgrName);

  // 3. Users assigned to those roles
  let users = [];
  if (roleNames.length > 0) {
    const usersRes = await pool.query(
      `
      SELECT DISTINCT
        "Uname",
        COALESCE("FullName", '') AS "FullName",
        COALESCE("Department", '') AS "Department",
        COALESCE("Locked", false) AS "Locked",
        "AgrName"
      FROM "RoleUserAssignments"
      WHERE "AgrName" = ANY($1)
      ORDER BY "Uname" ASC, "AgrName" ASC
      LIMIT 200;
      `,
      [roleNames]
    );
    users = usersRes.rows;
  }

  // 4. Authorization object entries for this T-Code / App
  const authRes = await pool.query(
    `
    SELECT
      "Object",
      "Field",
      "Low",
      COALESCE("High", '') AS "High",
      COUNT(DISTINCT "AgrName")::int AS "RoleCount"
    FROM "RoleAuthorizations"
    WHERE UPPER(TRIM("Low")) = $1
      AND ("Field" = 'TCD' OR "Object" IN ('S_TCODE', 'S_START', '/UI2/CHIP'))
    GROUP BY "Object", "Field", "Low", COALESCE("High", '')
    ORDER BY "RoleCount" DESC, "Object" ASC;
    `,
    [cleanId]
  );

  // 5. Related / similar apps powered by pgvector cosine distance
  let relatedApps = [];
  if (app.hasVector) {
    const simRes = await pool.query(
      `
      SELECT
        f."AppId",
        f."TCode",
        f."AppName",
        f."OneLineDescription",
        f."ActionCategory",
        f."RoleCount",
        ROUND((1 - (f."Embedding" <=> target."Embedding"))::numeric, 4) AS "similarity"
      FROM "FioriAppCatalog" f
      CROSS JOIN (
        SELECT "Embedding" FROM "FioriAppCatalog" WHERE "AppId" = $1
      ) target
      WHERE f."AppId" != $1
        AND f."Embedding" IS NOT NULL
        AND target."Embedding" IS NOT NULL
      ORDER BY f."Embedding" <=> target."Embedding" ASC
      LIMIT 6;
      `,
      [app.AppId]
    );
    relatedApps = simRes.rows.map((r) => ({
      ...r,
      similarity: parseFloat(r.similarity) || 0,
    }));
  }

  return {
    app,
    roles: rolesRes.rows,
    users,
    authObjects: authRes.rows,
    relatedApps,
  };
}

