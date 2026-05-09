const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ---- Constants ----
const EVENTS = { GB: "GB", LB: "LB" };
const TYPE = { WORLD: "world", ROOKIE: "rookie", CIRCUIT: "circuit" };
const CIRCUITS = {
  BADLANDS: { title: "Badlands", id: 13 },
  CALIFORNIA: { title: "California", id: 2 },
  COLUMBIA_RIVER: { title: "Columbia%20River", id: 1 },
  FIRST_FRONTIER: { title: "First%20Frontier", id: 11 },
  GREAT_LAKES: { title: "Great%20Lakes", id: 9 },
  MAPLE_LEAF: { title: "Maple%20Leaf", id: 12 },
  MONTANA: { title: "Montana", id: 4 },
  MOUNTAIN_STATES: { title: "Mountain%20States", id: 5 },
  PRAIRIE: { title: "Prairie", id: 8 },
  SOUTHEASTERN: { title: "Southeastern", id: 10 },
  TEXAS: { title: "Texas", id: 7 },
  TURQUOISE: { title: "Turquoise", id: 6 },
  WILDERNESS: { title: "Wilderness", id: 3 },
  // MEXICO: { title: "Mexico", id: 14 },
  // BRAZIL: { title: "Brazil", id: 15 },
};
const CIRCUIT_SVC_MODIFIERS = {
  badlands: "bl",
  california: "ca",
  "columbia river": "cr",
  "first frontier": "ff",
  "great lakes": "gl",
  "maple leaf": "ml",
  montana: "mt",
  "mountain states": "ms",
  prairie: "pr",
  southeastern: "se",
  texas: "tx",
  turquoise: "tq",
  wilderness: "wi",
};

const outputDir =
  process.env.WPRA_OUTPUT_DIR ||
  path.resolve(__dirname, "data");

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const DELAY_MS = 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// ---- Helpers ----
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressBar(current, total) {
  const percent = Math.floor((current / total) * 100);
  const filled = "█".repeat(Math.floor(percent / 4));
  const empty = "░".repeat(25 - Math.floor(percent / 4));
  process.stdout.write(`\rProgress: [${filled}${empty}] ${percent}%`);
}

function writeTimestampHTML() {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "long",
  });
  const htmlPath = path.join(outputDir, "index.html");
  fs.writeFileSync(
    htmlPath,
    `<p>Last updated: ${timestamp} (Central Time)</p>\n`,
    "utf-8",
  );
  console.log(`\n🕒 Updated timestamp file: ${htmlPath}`);
}

function hasExistingOutput(year, type, id, event) {
  const modernName = path.join(
    outputDir,
    `standings-year=${year}&type=${type}&id=${id}&event=${event}.json`,
  );
  const legacyName = path.join(
    outputDir,
    `standings?year=${year}&type=${type}&id=${id}&event=${event}.json`,
  );
  return fs.existsSync(modernName) || fs.existsSync(legacyName);
}

function parseFileMetadata(filename) {
  const base = path.basename(filename);
  if (!base.endsWith(".json")) return null;
  const paramsString = base
    .replace(/^standings[-?]/, "")
    .replace(/\.json$/, "");
  const params = new URLSearchParams(paramsString);
  const type = params.get("type");
  const year = Number.parseInt(params.get("year") || "", 10);
  const circuitIdRaw = params.get("id");
  const event = params.get("event");
  if (!type || !Number.isFinite(year) || !event || circuitIdRaw === null) {
    return null;
  }
  const circuitId = circuitIdRaw === "" ? null : Number.parseInt(circuitIdRaw, 10);
  return {
    type,
    year,
    event,
    circuitId: Number.isFinite(circuitId) ? circuitId : null,
  };
}

function normalizePayloadForFile(filename, payload) {
  const meta = parseFileMetadata(filename);
  if (!meta || !payload || !Array.isArray(payload.data)) return payload;

  const normalizedData = payload.data.map((row) => ({
    ...row,
    Type: meta.type,
    Event: meta.event,
    SeasonYear: meta.year,
    ...(meta.circuitId !== null ? { CircuitId: meta.circuitId } : {}),
  }));

  return {
    ...payload,
    data: normalizedData,
  };
}

function writeNormalizedPayload(filename, payload) {
  const normalized = normalizePayloadForFile(filename, payload);
  fs.writeFileSync(filename, JSON.stringify(normalized, null, 2));
  return normalized;
}

function normalizeExistingOutputFiles() {
  const files = fs
    .readdirSync(outputDir)
    .filter((name) => name.startsWith("standings") && name.endsWith(".json"));
  let normalizedCount = 0;

  for (const file of files) {
    const filename = path.join(outputDir, file);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(filename, "utf-8"));
    } catch {
      continue;
    }
    const normalized = normalizePayloadForFile(filename, payload);
    fs.writeFileSync(filename, JSON.stringify(normalized, null, 2));
    normalizedCount++;
  }

  console.log(`\n🧹 Normalized ${normalizedCount} existing output files.`);
}

function buildSupabaseRows(filename, payload) {
  const meta = parseFileMetadata(filename);
  if (!meta || !payload || !Array.isArray(payload.data)) return [];

  return payload.data.map((row) => ({
    season_year: meta.year,
    event: meta.event,
    type: meta.type,
    circuit_id: meta.circuitId,
    place: row.Place ?? null,
    first_name: row.FirstName ?? null,
    last_name: row.LastName ?? null,
    hometown: row.Hometown ?? null,
    earnings: row.Earnings ?? null,
    points: row.Points ?? null,
    updated_at: new Date().toISOString(),
  }));
}

async function upsertSupabaseRows(filename, payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const rows = buildSupabaseRows(filename, payload).filter(
    (row) => Number.isFinite(row.place) && row.place > 0,
  );
  if (!rows.length) return;

  const endpoint =
    `${SUPABASE_URL}/rest/v1/standings` +
    "?on_conflict=season_year,event,type,circuit_id_key,place";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase upsert failed (${response.status}): ${body}`);
  }
}

// ---- Scraper ----
async function getWpra(event, type, year, circuit) {
  const currentYear = new Date().getFullYear();
  const circuitName = decodeURIComponent(circuit || "")
    .toLowerCase()
    .trim();
  const modernCircuitSlug = circuitName
    .toLowerCase()
    .replace(/\s+/g, "-");
  const circuitSvcModifier = CIRCUIT_SVC_MODIFIERS[circuitName];

  function urls() {
    if (year === 2025) {
      if (event === EVENTS.GB && type === TYPE.WORLD) {
        return ["https://wpra.com/pro-rodeo-world-standings-2025/"];
      }

      if (event === EVENTS.GB && type === TYPE.ROOKIE) {
        return [
          "https://wpra.com/wpra-resistol-rookie-2025/",
          "https://wpra.com/wpra-resistol-rookie-barrels-2025/",
        ];
      }

      if (event === EVENTS.LB && type === TYPE.WORLD) {
        return ["https://wpra.com/pro-rodeo-breakaway-world-standings-2025/"];
      }

      if (event === EVENTS.LB && type === TYPE.ROOKIE) {
        return ["https://wpra.com/wpra-resistol-rookie-breakaway-2025/"];
      }

      if (event === EVENTS.GB && type === TYPE.CIRCUIT) {
        return [
          `https://wpra.com/pro-rodeo-circuit-standings-${modernCircuitSlug}-2025/`,
        ];
      }

      if (event === EVENTS.LB && type === TYPE.CIRCUIT) {
        return [
          `https://wpra.com/pro-rodeo-breakaway-circuit-standings-${modernCircuitSlug}-2025/`,
        ];
      }
    }

    if (event === EVENTS.GB && type === TYPE.WORLD && year === currentYear) {
      return [
        "https://wpra.com/pro-rodeo-world-standings/?svcUrl=pro-gb-world",
        `https://wpra.com/pro-rodeo-world-standings-${currentYear}/`,
        "https://wpra.com/pro-rodeo-world-standings/",
      ];
    }

    if (event === EVENTS.GB && type === TYPE.ROOKIE && year === currentYear) {
      return [
        "https://wpra.com/wpra-resistol-rookie-barrels/?svcUrl=pro-gb-world-rk",
        `https://wpra.com/wpra-resistol-rookie-barrels-${currentYear}/`,
        `https://wpra.com/wpra-resistol-rookie-${currentYear}/`,
      ];
    }

    if (event === EVENTS.LB && type === TYPE.WORLD && year === currentYear) {
      return [
        "https://wpra.com/pro-rodeo-breakaway-world-standings/?svcUrl=pro-lbk-world",
        `https://wpra.com/pro-rodeo-breakaway-world-standings-${currentYear}/`,
        "https://wpra.com/pro-rodeo-breakaway-world-standings/",
      ];
    }

    if (event === EVENTS.LB && type === TYPE.ROOKIE && year === currentYear) {
      return [
        "https://wpra.com/wpra-resistol-rookie-breakaway/?svcUrl=pro-lbk-world-rk",
        `https://wpra.com/wpra-resistol-rookie-breakaway-${currentYear}/`,
      ];
    }

    if (event === EVENTS.GB && type === TYPE.CIRCUIT && year === currentYear) {
      return [
        ...(circuitSvcModifier
          ? [
              `https://wpra.com/pro-rodeo-circuit-standings/?svcUrl=pro-gb-${circuitSvcModifier}`,
            ]
          : []),
        "https://wpra.com/pro-rodeo-circuit-standings/",
        `https://wpra.com/pro-rodeo-circuit-standings-${modernCircuitSlug}-${currentYear}/`,
      ];
    }

    if (event === EVENTS.LB && type === TYPE.CIRCUIT && year === currentYear) {
      return [
        ...(circuitSvcModifier
          ? [
              `https://wpra.com/pro-rodeo-breakaway-circuit-standings/?svcUrl=pro-lbk-${circuitSvcModifier}`,
            ]
          : []),
        "https://wpra.com/pro-rodeo-breakaway-circuit-standings/",
        `https://wpra.com/pro-rodeo-breakaway-circuit-standings-${modernCircuitSlug}-${currentYear}/`,
      ];
    }

    if (event === EVENTS.GB && type === TYPE.WORLD)
      return [
        `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo%20-%20World&season=${year}&standing=${year}%20Pro%20Rodeo%20World%20Standings`,
      ];

    if (event === EVENTS.GB && type === TYPE.ROOKIE)
      return [
        `https://archived.wpra.com/index.php/standings-group-season?group=Rookie%20Standings&season=${year}&standing=${year}%20Rookie%20Standings`,
      ];

    if (event === EVENTS.GB && type === TYPE.CIRCUIT)
      return [
        `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo-Circuit&season=${year}&standing=${year}%20Pro%20Rodeo%20${circuit}%20Circuit%20Standings`,
      ];

    if (event === EVENTS.LB && type === TYPE.WORLD)
      return [
        `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Pro%20Rodeo%20Breakaway%20World%20Standings`,
      ];

    if (event === EVENTS.LB && type === TYPE.CIRCUIT)
      return [
        `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Pro%20Rodeo%20Breakaway%20${circuit}%20Circuit%20Standings`,
      ];

    return [];
  }

  const targetUrls = urls();
  if (!targetUrls.length) return { error: "Invalid params", data: [] };

  let response = null;
  let lastError = null;

  for (const targetUrl of targetUrls) {
    try {
      const candidate = await axios.get(targetUrl, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        validateStatus: (status) => status < 500,
      });

      if (candidate.status >= 400) {
        lastError = `HTTP ${candidate.status} for ${targetUrl}`;
        console.warn(lastError);
        continue;
      }

      response = candidate;
      break;
    } catch (err) {
      const message = err?.message || "Request failed";
      lastError = `Request error for ${targetUrl}: ${message}`;
      console.warn(lastError);
    }
  }

  if (!response) {
    return { error: lastError || "All URL attempts failed", data: [] };
  }

  const $ = cheerio.load(response.data);
  const rows = $("table tr");
  const rawData = [];

  rows.each((i, row) => {
    const rankRaw = $(row).find("td:nth-child(1)").text().trim();
    const placeValue = Number(rankRaw.replace(" (T)", "").trim());
    if (!Number.isFinite(placeValue) || placeValue <= 0) return;

    const nameRaw = $(row).find("td:nth-child(2)").text().trim();
    const name = nameRaw
      .split(/\s+/)
      .filter((part) => part && !part.includes("("));
    const FirstName = name[0];
    const LastName = name[name.length - 1];
    if (!FirstName || !LastName) return;

    const Hometown = $(row).find("td:nth-child(3)").text().trim();
    const earningsRaw = $(row).find("td:nth-child(4)").text().trim();
    const earningsValue = parseFloat(
      earningsRaw.replace(/,/g, "").replace("$", ""),
    );
    if (!Number.isFinite(earningsValue)) return;

    const Place = placeValue;
    const Earnings = earningsValue;
    const Event = event;
    const Type = type;
    const Points = Earnings;
    const SeasonYear = Number(year);
    const StandingId = 0;
    const ContestantId = 0;

    rawData.push({
      ContestantId,
      Place,
      FirstName,
      LastName,
      Hometown,
      Earnings,
      Event,
      Type,
      Points,
      SeasonYear,
      StandingId,
    });
  });

  const data = rawData.slice(0, 50);
  return { error: null, data };
}

// ---- Runner ----
async function runAll() {
  const currentYear = new Date().getFullYear();
  const startYearDefault = 2014;
  const lbStartYear = 2020;
  const forcedRefreshYears = new Set(
    (process.env.WPRA_REFRESH_YEARS || "")
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isFinite),
  );
  const circuits = Object.values(CIRCUITS);
  const events = Object.values(EVENTS);
  const types = Object.values(TYPE);

  // Compute total tasks
  let totalTasks = 0;
  for (const event of events) {
    const startYear = event === EVENTS.LB ? lbStartYear : startYearDefault;
    for (const type of types) {
      if (type === TYPE.CIRCUIT) {
        totalTasks += circuits.length * (currentYear - startYear + 1);
      } else {
        totalTasks += currentYear - startYear + 1;
      }
    }
  }

  let completed = 0;

  // Actual run
  for (const event of events) {
    const startYear = event === EVENTS.LB ? lbStartYear : startYearDefault;

    for (const type of types) {
      if (type === TYPE.CIRCUIT) {
        for (const circuit of circuits) {
          for (let year = startYear; year <= currentYear; year++) {
            const filename = path.join(
              outputDir,
              `standings-year=${year}&type=${type}&id=${circuit.id}&event=${event}.json`,
            );

            if (
              year !== currentYear &&
              !forcedRefreshYears.has(year) &&
              hasExistingOutput(year, type, circuit.id, event)
            ) {
              completed++;
              progressBar(completed, totalTasks);
              continue;
            }

            const { error, data } = await getWpra(
              event,
              type,
              year,
              circuit.title,
            );
            const normalized = writeNormalizedPayload(filename, { error, data });
            await upsertSupabaseRows(filename, normalized);
            completed++;
            progressBar(completed, totalTasks);
            await delay(DELAY_MS);
          }
        }
      } else {
        for (let year = startYear; year <= currentYear; year++) {
          const filename = path.join(
            outputDir,
            `standings-year=${year}&type=${type}&id=&event=${event}.json`,
          );

          if (
            year !== currentYear &&
            !forcedRefreshYears.has(year) &&
            hasExistingOutput(year, type, "", event)
          ) {
            completed++;
            progressBar(completed, totalTasks);
            continue;
          }

          const { error, data } = await getWpra(event, type, year);
          const normalized = writeNormalizedPayload(filename, { error, data });
          await upsertSupabaseRows(filename, normalized);
          completed++;
          progressBar(completed, totalTasks);
          await delay(DELAY_MS);
        }
      }
    }
  }

  process.stdout.write("\n🏁 All scraping complete!\n");
  normalizeExistingOutputFiles();
  writeTimestampHTML();
}

// ---- Run ----
runAll().catch(console.error);
