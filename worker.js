export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-app-token",
  "Access-Control-Max-Age": "86400"
};

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: { ...BASE_HEADERS, ...CORS_HEADERS } });
  }

  try {
    await ensureSchema(env);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "FinSight Worker API",
        version: "1.2.0",
        hasOpenAI: Boolean(env.OPENAI_API_KEY),
        hasAppToken: Boolean(env.APP_TOKEN),
        ts: new Date().toISOString()
      });
    }

    const publicRoutes = new Set([
      "/api/bootstrap",
      "/api/dcf",
      "/api/credit",
      "/api/budget",
      "/api/board-summary"
    ]);

    if (!publicRoutes.has(url.pathname)) {
      const auth = requireAuth(request, env);
      if (auth) return auth;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return json({
        ok: true,
        appName: "FinSight Pro",
        version: "1.2.0",
        hasOpenAI: Boolean(env.OPENAI_API_KEY),
        routes: [
          "GET /health",
          "GET /api/bootstrap",
          "POST /api/profile/save",
          "GET /api/profile/load",
          "POST /api/import/csv",
          "POST /api/dcf",
          "POST /api/credit",
          "POST /api/budget",
          "POST /api/board-summary",
          "POST /api/scenario/save",
          "GET /api/scenario/list",
          "GET /api/scenario/get?id=...",
          "POST /api/chat/save-user",
          "GET /api/chat/history",
          "POST /api/chat"
        ],
        starterProfile: normalizeProfile({
          companyName: "Northstar Analytics",
          userName: "Jordan Lee",
          industry: "Technology / SaaS",
          stage: "Growth Stage",
          revenue: 6200000,
          employees: 52,
          ebitda: 1320000,
          debt: 1850000,
          equity: 4700000,
          netIncome: 690000,
          goal: "Raise capital / funding",
          challenge: "Working capital management"
        })
      });
    }

    if (request.method === "POST" && url.pathname === "/api/profile/save") {
      const body = await readJson(request);
      const workspaceId = sanitizeWorkspace(body.workspaceId || "default");
      const profile = normalizeProfile(body.profile || {});

      await env.DB.prepare(`
        INSERT INTO profiles (
          workspace_id, company_name, user_name, industry, stage, revenue, employees,
          ebitda, debt, equity, net_income, goal, challenge, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          company_name=excluded.company_name,
          user_name=excluded.user_name,
          industry=excluded.industry,
          stage=excluded.stage,
          revenue=excluded.revenue,
          employees=excluded.employees,
          ebitda=excluded.ebitda,
          debt=excluded.debt,
          equity=excluded.equity,
          net_income=excluded.net_income,
          goal=excluded.goal,
          challenge=excluded.challenge,
          updated_at=excluded.updated_at
      `).bind(
        workspaceId,
        profile.companyName,
        profile.userName,
        profile.industry,
        profile.stage,
        profile.revenue,
        profile.employees,
        profile.ebitda,
        profile.debt,
        profile.equity,
        profile.netIncome,
        profile.goal,
        profile.challenge,
        Date.now()
      ).run();

      return json({ ok: true, profile });
    }

    if (request.method === "GET" && url.pathname === "/api/profile/load") {
      const workspaceId = sanitizeWorkspace(url.searchParams.get("workspaceId") || "default");
      const row = await env.DB.prepare("SELECT * FROM profiles WHERE workspace_id = ?").bind(workspaceId).first();
      return json({ ok: true, profile: row ? mapDbProfileRow(row) : null });
    }

    if (request.method === "POST" && url.pathname === "/api/import/csv") {
      const body = await readJson(request);
      const workspaceId = sanitizeWorkspace(body.workspaceId || "default");
      const csvText = String(body.csvText || "").trim();
      const parsed = parseFinancialCsv(csvText);
      const suggestedProfile = suggestProfileFromTotals(parsed.totals);

      await env.DB.prepare(`
        INSERT INTO imports (workspace_id, raw_csv, parsed_json, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(workspaceId, csvText, JSON.stringify(parsed), Date.now()).run();

      return json({ ok: true, parsed, suggestedProfile });
    }

    if (request.method === "POST" && url.pathname === "/api/dcf") {
      const body = await readJson(request);
      return json({ ok: true, result: runDCF(body) });
    }

    if (request.method === "POST" && url.pathname === "/api/credit") {
      const body = await readJson(request);
      return json({ ok: true, result: runCredit(body) });
    }

    if (request.method === "POST" && url.pathname === "/api/budget") {
      const body = await readJson(request);
      return json({ ok: true, result: runBudget(body) });
    }

    if (request.method === "POST" && url.pathname === "/api/board-summary") {
      const body = await readJson(request);
      const profile = normalizeProfile(body.profile || {});
      return json({ ok: true, summary: buildBoardSummary(profile) });
    }

    if (request.method === "POST" && url.pathname === "/api/scenario/save") {
      const body = await readJson(request);
      const workspaceId = sanitizeWorkspace(body.workspaceId || "default");
      const scenarioName = String(body.scenarioName || "Untitled Scenario").slice(0, 120);
      const payload = JSON.stringify(body.payload || {});
      await env.DB.prepare(`
        INSERT INTO scenarios (workspace_id, scenario_name, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(workspaceId, scenarioName, payload, Date.now(), Date.now()).run();
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/scenario/list") {
      const workspaceId = sanitizeWorkspace(url.searchParams.get("workspaceId") || "default");
      const rows = await env.DB.prepare(`
        SELECT id, scenario_name, payload_json, created_at, updated_at
        FROM scenarios WHERE workspace_id = ? ORDER BY updated_at DESC
      `).bind(workspaceId).all();
      return json({ ok: true, scenarios: rows.results || [] });
    }

    if (request.method === "GET" && url.pathname === "/api/scenario/get") {
      const workspaceId = sanitizeWorkspace(url.searchParams.get("workspaceId") || "default");
      const scenarioId = Number(url.searchParams.get("id") || 0);
      if (!scenarioId) return json({ ok: false, error: "Scenario id is required" }, 400);
      const row = await env.DB.prepare(`
        SELECT id, scenario_name, payload_json, created_at, updated_at
        FROM scenarios WHERE workspace_id = ? AND id = ?
      `).bind(workspaceId, scenarioId).first();
      if (!row) return json({ ok: false, error: "Scenario not found" }, 404);
      return json({
        ok: true,
        scenario: {
          ...row,
          payload: safeJsonParse(row.payload_json, {})
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(request);
      const workspaceId = sanitizeWorkspace(body.workspaceId || "default");
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const profile = normalizeProfile(body.profile || {});
      let reply = "";
      let source = "local-fallback";

      if (env.OPENAI_API_KEY) {
        try {
          reply = await openAIChat(messages, profile, env);
          source = "openai";
        } catch (error) {
          reply = localFinanceFallback(messages, profile, error?.message);
          source = "local-fallback";
        }
      } else {
        reply = localFinanceFallback(messages, profile);
      }

      await env.DB.prepare(`
        INSERT INTO chat_history (workspace_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(workspaceId, "assistant", reply, Date.now()).run();

      return json({ ok: true, reply, source });
    }

    if (request.method === "POST" && url.pathname === "/api/chat/save-user") {
      const body = await readJson(request);
      const workspaceId = sanitizeWorkspace(body.workspaceId || "default");
      const content = String(body.content || "").slice(0, 8000);
      await env.DB.prepare(`
        INSERT INTO chat_history (workspace_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(workspaceId, "user", content, Date.now()).run();
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/chat/history") {
      const workspaceId = sanitizeWorkspace(url.searchParams.get("workspaceId") || "default");
      const rows = await env.DB.prepare(`
        SELECT role, content, created_at
        FROM chat_history
        WHERE workspace_id = ?
        ORDER BY created_at ASC
        LIMIT 100
      `).bind(workspaceId).all();
      return json({ ok: true, history: rows.results || [] });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    return json({
      ok: false,
      error: err?.message || "Unknown error"
    }, 500);
  }
}

function requireAuth(request, env) {
  if (!env.APP_TOKEN) return null;
  const token = request.headers.get("x-app-token");
  if (!token || token !== env.APP_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  return null;
}

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      workspace_id TEXT PRIMARY KEY,
      company_name TEXT,
      user_name TEXT,
      industry TEXT,
      stage TEXT,
      revenue REAL,
      employees INTEGER,
      ebitda REAL,
      debt REAL,
      equity REAL,
      net_income REAL,
      goal TEXT,
      challenge TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      raw_csv TEXT NOT NULL,
      parsed_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scenario_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_imports_workspace ON imports(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scenarios_workspace ON scenarios(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_workspace ON chat_history(workspace_id, created_at ASC);
  `);
  schemaReady = true;
}

function normalizeProfile(input) {
  return {
    companyName: String(input.companyName || input.company_name || "Acme Corp").slice(0, 120),
    userName: String(input.userName || input.user_name || "Alex Chen").slice(0, 120),
    industry: String(input.industry || "Technology / SaaS").slice(0, 120),
    stage: String(input.stage || "Growth Stage").slice(0, 120),
    revenue: parseNumber(input.revenue, 5000000),
    employees: Math.max(0, Math.round(parseNumber(input.employees, 45))),
    ebitda: parseNumber(input.ebitda, 1200000),
    debt: parseNumber(input.debt, 2000000),
    equity: parseNumber(input.equity, 4000000),
    netIncome: parseNumber(input.netIncome ?? input.net_income, 600000),
    goal: String(input.goal || "Improve profitability margins").slice(0, 200),
    challenge: String(input.challenge || "Cash flow management").slice(0, 200)
  };
}

function mapDbProfileRow(row) {
  return normalizeProfile({
    companyName: row.company_name,
    userName: row.user_name,
    industry: row.industry,
    stage: row.stage,
    revenue: row.revenue,
    employees: row.employees,
    ebitda: row.ebitda,
    debt: row.debt,
    equity: row.equity,
    netIncome: row.net_income,
    goal: row.goal,
    challenge: row.challenge
  });
}

function suggestProfileFromTotals(totals) {
  const value = pickMetric(totals, ["Revenue", "Annual Revenue", "Sales"]);
  const ebitda = pickMetric(totals, ["EBITDA"]);
  const debt = pickMetric(totals, ["Debt", "Total Debt"]);
  const equity = pickMetric(totals, ["Equity", "Shareholder Equity"]);
  const netIncome = pickMetric(totals, ["Net Income", "Profit"]);
  return {
    revenue: value,
    ebitda,
    debt,
    equity,
    netIncome
  };
}

function pickMetric(totals, candidates) {
  const entries = Object.entries(totals || {});
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found) return parseNumber(found[1], 0);
  }
  return 0;
}

function sanitizeWorkspace(input) {
  return String(input || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "default";
}

function parseNumber(value, fallback = 0) {
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%\s]/g, "").replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function runDCF(body) {
  const initialInvestment = parseNumber(body.initialInvestment, 500000);
  const cashFlows = Array.isArray(body.cashFlows)
    ? body.cashFlows.map(v => parseNumber(v, 0)).filter(v => Number.isFinite(v))
    : [120000, 148000, 172000, 201000, 235000, 265000];
  const wacc = parseNumber(body.wacc, 10) / 100;
  const terminalGrowth = parseNumber(body.terminalGrowth, 3) / 100;

  const presentValues = cashFlows.map((cf, idx) => cf / Math.pow(1 + wacc, idx + 1));
  const lastCF = cashFlows[cashFlows.length - 1] || 0;
  const terminalValue = wacc > terminalGrowth
    ? (lastCF * (1 + terminalGrowth)) / (wacc - terminalGrowth)
    : 0;
  const terminalPV = terminalValue / Math.pow(1 + wacc, cashFlows.length || 1);

  const npv = -initialInvestment + presentValues.reduce((a, b) => a + b, 0) + terminalPV;

  let cumulativePV = -initialInvestment;
  let paybackPeriod = null;
  const schedule = [{ year: 0, cashFlow: -initialInvestment, discountFactor: 1, presentValue: -initialInvestment, cumulativePV }];

  presentValues.forEach((pv, idx) => {
    const discountFactor = 1 / Math.pow(1 + wacc, idx + 1);
    const prev = cumulativePV;
    cumulativePV += pv;
    if (paybackPeriod === null && cumulativePV >= 0 && pv > 0) {
      paybackPeriod = idx + ((0 - prev) / pv);
    }
    schedule.push({
      year: idx + 1,
      cashFlow: cashFlows[idx],
      discountFactor,
      presentValue: pv,
      cumulativePV
    });
  });

  schedule.push({
    year: "TV",
    cashFlow: terminalValue,
    discountFactor: 1 / Math.pow(1 + wacc, cashFlows.length || 1),
    presentValue: terminalPV,
    cumulativePV
  });

  const irr = estimateIRR(initialInvestment, cashFlows);
  const profitabilityIndex = initialInvestment > 0
    ? (presentValues.reduce((a, b) => a + b, 0) + terminalPV) / initialInvestment
    : 0;

  return {
    initialInvestment,
    cashFlows,
    waccPercent: wacc * 100,
    terminalGrowthPercent: terminalGrowth * 100,
    terminalValue,
    terminalPV,
    npv,
    irrPercent: irr * 100,
    paybackPeriod,
    profitabilityIndex,
    schedule
  };
}

function estimateIRR(initialInvestment, cashFlows) {
  let low = -0.99;
  let high = 5;
  for (let i = 0; i < 120; i++) {
    const mid = (low + high) / 2;
    const npv = -initialInvestment + cashFlows.reduce((sum, cf, idx) => sum + cf / Math.pow(1 + mid, idx + 1), 0);
    if (npv > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function runCredit(body) {
  const ebitda = parseNumber(body.ebitda, 1200000);
  const debt = parseNumber(body.debt, 2000000);
  const equity = parseNumber(body.equity, 4000000);
  const interestExpense = parseNumber(body.interestExpense, 180000);
  const currentAssets = parseNumber(body.currentAssets, 1200000);
  const currentLiabilities = parseNumber(body.currentLiabilities, 600000);
  const netIncome = parseNumber(body.netIncome, 600000);
  const revenue = parseNumber(body.revenue, 5000000);

  const metrics = {
    debtToEbitda: ebitda ? debt / ebitda : 99,
    debtToEquity: equity ? debt / equity : 99,
    interestCoverage: interestExpense ? ebitda / interestExpense : 99,
    currentRatio: currentLiabilities ? currentAssets / currentLiabilities : 99,
    netMargin: revenue ? netIncome / revenue : 0,
    roe: equity ? netIncome / equity : 0
  };

  const scores = {
    liquidity: scoreLinear(metrics.currentRatio, 1, 2.2),
    leverage: scoreReverse(metrics.debtToEbitda, 2.5, 5),
    coverage: scoreLinear(metrics.interestCoverage, 1.5, 6),
    profitability: scoreLinear(metrics.netMargin, 0.03, 0.2),
    returns: scoreLinear(metrics.roe, 0.05, 0.2),
    efficiency: scoreReverse(metrics.debtToEquity, 1, 2.5)
  };

  const composite = Math.round(
    scores.liquidity * 0.15 +
    scores.leverage * 0.25 +
    scores.coverage * 0.2 +
    scores.profitability * 0.15 +
    scores.returns * 0.15 +
    scores.efficiency * 0.1
  );

  let rating = "B";
  if (composite >= 82) rating = "A";
  else if (composite >= 70) rating = "BBB";
  else if (composite >= 58) rating = "BB";
  else if (composite >= 45) rating = "B";
  else rating = "CCC";

  const maxPrudentDebt = ebitda * 3;
  const debtHeadroom = maxPrudentDebt - debt;

  return {
    composite,
    rating,
    scores,
    metrics,
    maxPrudentDebt,
    debtHeadroom
  };
}

function scoreLinear(value, bad, good) {
  if (!Number.isFinite(value)) return 0;
  if (value <= bad) return 0;
  if (value >= good) return 100;
  const x = (value - bad) / (good - bad);
  return Math.max(0, Math.min(100, Math.round(x * 100)));
}

function scoreReverse(value, good, bad) {
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round((1 - (value - good) / (bad - good)) * 100);
}

function runBudget(body) {
  const revenueItems = Array.isArray(body.revenueItems) ? body.revenueItems : [];
  const cogsItems = Array.isArray(body.cogsItems) ? body.cogsItems : [];
  const opexItems = Array.isArray(body.opexItems) ? body.opexItems : [];

  const totalRevenue = revenueItems.reduce((s, item) => s + parseNumber(item.amount, 0), 0);
  const totalCOGS = cogsItems.reduce((s, item) => s + parseNumber(item.amount, 0), 0);
  const totalOpex = opexItems.reduce((s, item) => s + parseNumber(item.amount, 0), 0);

  const grossProfit = totalRevenue - totalCOGS;
  const ebitda = grossProfit - totalOpex;
  const depreciation = parseNumber(body.depreciation, 85000);
  const ebit = ebitda - depreciation;
  const tax = Math.max(0, ebit * 0.21);
  const netIncome = ebit - tax;

  return {
    totals: {
      totalRevenue,
      totalCOGS,
      totalOpex,
      grossProfit,
      ebitda,
      depreciation,
      ebit,
      tax,
      netIncome
    },
    margins: {
      grossMargin: totalRevenue > 0 ? grossProfit / totalRevenue : 0,
      ebitdaMargin: totalRevenue > 0 ? ebitda / totalRevenue : 0,
      netMargin: totalRevenue > 0 ? netIncome / totalRevenue : 0
    }
  };
}

function parseFinancialCsv(csvText) {
  const rows = csvText.trim().split(/\r?\n/).map(line => splitCSV(line));
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one data row.");

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const dataRows = rows.slice(1).filter(row => row.some(cell => String(cell || "").trim()));

  const normalized = dataRows.map(row => {
    const obj = {};
    headers.forEach((header, idx) => obj[header] = row[idx]);
    return obj;
  });

  const totals = {};
  for (const rec of normalized) {
    const metric = String(rec.metric || rec.account || rec.name || "").trim();
    const amount = parseNumber(rec.amount || rec.value || rec.total, 0);
    if (metric) totals[metric] = amount;
  }

  return { headers, records: normalized, totals, rowCount: normalized.length };
}

function splitCSV(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(x => x.trim());
}

function buildBoardSummary(profile) {
  const revenue = profile.revenue || 0;
  const ebitda = profile.ebitda || 0;
  const debt = profile.debt || 0;
  const equity = profile.equity || 0;
  const netIncome = profile.netIncome || 0;
  const ebitdaMargin = revenue ? ebitda / revenue : 0;
  const netMargin = revenue ? netIncome / revenue : 0;
  const debtToEbitda = ebitda ? debt / ebitda : 0;
  const debtToEquity = equity ? debt / equity : 0;

  let headline = `${profile.companyName} combines ${fmtMoney(revenue)} of revenue with ${pct(ebitdaMargin)} EBITDA margin.`;
  let risk = debtToEbitda <= 3
    ? `Leverage is currently manageable at ${debtToEbitda.toFixed(2)}x Debt/EBITDA.`
    : `Leverage is elevated at ${debtToEbitda.toFixed(2)}x Debt/EBITDA and should be framed carefully.`;
  const action = profile.goal.toLowerCase().includes("capital")
    ? "Best narrative: show that new capital accelerates value creation rather than covering weak unit economics."
    : `Best narrative: tie next steps directly to ${profile.goal.toLowerCase()} while protecting margin and liquidity.`;

  return {
    headline,
    bullets: [
      `Net margin is ${pct(netMargin)} and Debt/Equity is ${debtToEquity.toFixed(2)}x.`,
      risk,
      action
    ]
  };
}

async function openAIChat(messages, profile, env) {
  const userMessages = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .slice(-12)
    .map(m => ({
      role: m.role,
      content: String(m.content || "").slice(0, 4000)
    }));

  const system = [
    "You are FinSight Pro, a sharp corporate finance copilot for demo judges, founders, and operators.",
    "Be concrete, concise, financially literate, and persuasive.",
    "When possible, structure answers into 2-4 crisp bullets or a short paragraph.",
    "Always tie your advice to the user's metrics when relevant.",
    `Profile: ${JSON.stringify(profile)}`
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 450,
      messages: [{ role: "system", content: system }, ...userMessages]
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${txt}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || localFinanceFallback(messages, profile);
}

function localFinanceFallback(messages, profile, modelError = "") {
  const last = String(messages?.[messages.length - 1]?.content || "").toLowerCase();
  const revenue = profile.revenue || 0;
  const ebitda = profile.ebitda || 0;
  const debt = profile.debt || 0;
  const equity = profile.equity || 0;
  const netIncome = profile.netIncome || 0;
  const ebitdaMargin = revenue ? (ebitda / revenue) * 100 : 0;
  const netMargin = revenue ? (netIncome / revenue) * 100 : 0;
  const debtToEbitda = ebitda ? (debt / ebitda) : 0;
  const debtToEquity = equity ? (debt / equity) : 0;
  const prefix = modelError ? `The model endpoint was unavailable, so here is a grounded local answer instead.\n\n` : "";

  if (last.includes("wacc")) {
    return prefix + `For a ${profile.stage} company in ${profile.industry}, frame WACC as the blended cost of debt and equity capital. In a demo, test at 8%, 10%, and 12% so judges see the valuation range rather than one fragile point estimate.`;
  }

  if (last.includes("debt") || last.includes("leverage") || last.includes("credit")) {
    return prefix + `Your leverage is roughly ${debtToEbitda.toFixed(2)}x Debt/EBITDA and ${debtToEquity.toFixed(2)}x Debt/Equity. The strongest explanation is whether that leverage still preserves flexibility for growth, hiring, and fundraising. If judges push on risk, answer with debt capacity, coverage, and the path to higher cash flow.`;
  }

  if (last.includes("margin") || last.includes("profit")) {
    return prefix + `Your EBITDA margin is about ${ebitdaMargin.toFixed(1)}% and net margin is about ${netMargin.toFixed(1)}%. The best strategic framing is whether margin expansion comes from scale, pricing, or cost discipline. Judges usually respond well when you separate durable improvements from temporary cuts.`;
  }

  if (last.includes("valuation") || last.includes("dcf") || last.includes("npv")) {
    return prefix + `For valuation, explain three levers first: cash flow growth, discount rate, and terminal assumptions. The most persuasive move is showing a base case, downside case, and upside case so the tool feels like a real decision platform instead of a single calculator.`;
  }

  if (last.includes("investor") || last.includes("raise") || last.includes("funding")) {
    return prefix + `If you are pitching investors, lead with revenue scale, margin quality, and how efficiently capital converts into growth. A clean structure is: where the business is today, what constraint exists, what the next capital unlocks, and why that lifts enterprise value.`;
  }

  return prefix + `Here is the current finance read: revenue is ${fmtMoney(revenue)}, EBITDA is ${fmtMoney(ebitda)}, debt is ${fmtMoney(debt)}, equity is ${fmtMoney(equity)}, and net income is ${fmtMoney(netIncome)}. The clearest next question is whether you should emphasize valuation, credit strength, margin expansion, or investor readiness.`;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtMoney(n) {
  const abs = Math.abs(n || 0);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...BASE_HEADERS,
      ...CORS_HEADERS
    }
  });
}
