const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

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
  process.env.WPRA_OUTPUT_DIR || path.resolve(__dirname, "data");

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const DELAY_MS = 3000;
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL || "";
const DATA_API_BASE_URL =
  process.env.NEON_DATA_API_URL || process.env.SUPABASE_URL || "";
const DATA_API_KEY =
  process.env.NEON_DATA_API_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
function normalizeDataApiUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    if (NEON_DATABASE_URL) return "";
    throw new Error(
      "NEON_DATA_API_URL must be the Neon Data API HTTP URL (.../rest/v1), not a Postgres connection string.",
    );
  }
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
    return `https://${value}`;
  }
  return value;
}

const NORMALIZED_DATA_API_URL = normalizeDataApiUrl(DATA_API_BASE_URL);

const DATA_API_AUTH_FROM_URL = (() => {
  if (!NORMALIZED_DATA_API_URL) return null;
  try {
    const parsed = new URL(NORMALIZED_DATA_API_URL);
    if (!parsed.username && !parsed.password) return null;
    const token = Buffer.from(
      `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
      "utf8",
    ).toString("base64");
    return `Basic ${token}`;
  } catch {
    return null;
  }
})();
const SAFE_DATA_API_BASE_URL = (() => {
  if (!NORMALIZED_DATA_API_URL) return "";
  try {
    const parsed = new URL(NORMALIZED_DATA_API_URL);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return NORMALIZED_DATA_API_URL.replace(/\/$/, "");
  }
})();

function applyDataApiAuthHeaders(headers) {
  if (DATA_API_KEY) {
    headers.apikey = DATA_API_KEY;
    headers.Authorization = `Bearer ${DATA_API_KEY}`;
    return headers;
  }
  if (DATA_API_AUTH_FROM_URL) {
    headers.Authorization = DATA_API_AUTH_FROM_URL;
  }
  return headers;
}

const sql = NEON_DATABASE_URL ? neon(NEON_DATABASE_URL) : null;

// ---- Helpers ----
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function makeAthleteNameKey(firstName, lastName) {
  return [normalizeLookupValue(firstName), normalizeLookupValue(lastName)].join(
    "|",
  );
}

function makeAthleteFullKey(firstName, lastName, hometown) {
  return [
    normalizeLookupValue(firstName),
    normalizeLookupValue(lastName),
    normalizeLookupValue(hometown),
  ].join("|");
}

function getEventIdPart(event) {
  if (event === EVENTS.GB) return "1";
  if (event === EVENTS.LB) return "2";
  return "";
}

function getTypeIdPart(type) {
  if (type === TYPE.WORLD) return "1";
  if (type === TYPE.ROOKIE) return "2";
  if (type === TYPE.CIRCUIT) return "3";
  return "";
}

function makeStandingsId(row) {
  const parts = [
    getEventIdPart(row.event),
    getTypeIdPart(row.type),
    Number.isFinite(row.circuit_id) && row.circuit_id > 0
      ? String(row.circuit_id)
      : "",
    Number.isFinite(row.season_year) ? String(row.season_year) : "",
    Number.isFinite(row.place) && row.place > 0 ? String(row.place) : "",
  ];

  const id = Number.parseInt(parts.join(""), 10);
  return Number.isFinite(id) ? id : null;
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
  const circuitId =
    circuitIdRaw === "" ? null : Number.parseInt(circuitIdRaw, 10);
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
    contestant_id:
      Number.isFinite(row.ContestantId) && row.ContestantId > 0
        ? row.ContestantId
        : null,
    photo_url: row.PhotoURL ?? null,
    place: row.Place ?? null,
    first_name: row.FirstName ?? null,
    last_name: row.LastName ?? null,
    hometown: row.Hometown ?? null,
    earnings: row.Earnings ?? null,
    points: row.Points ?? null,
    updated_at: new Date().toISOString(),
  }));
}

function dedupeSupabaseRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const contestantKey = row.contestant_id
      ? `id:${row.contestant_id}`
      : `${(row.first_name || "").trim().toLowerCase()}|${(row.last_name || "").trim().toLowerCase()}|${(row.hometown || "").trim().toLowerCase()}`;
    const key = [
      row.season_year,
      row.event,
      row.type,
      row.circuit_id ?? -1,
      contestantKey,
    ].join("|");
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function fetchWpraAthleteLookup() {
  const emptyLookup = {
    byFullKey: new Map(),
    byNameKey: new Map(),
  };

  let athletes = [];
  if (sql) {
    athletes = await sql`
      select contestant_id, first_name, last_name, hometown, photo_url
      from public.wpra_athletes
      order by contestant_id asc
    `;
  } else {
    if (!SAFE_DATA_API_BASE_URL) return emptyLookup;

    const pageSize = 1000;
    athletes = [];

    for (let offset = 0; ; offset += pageSize) {
      const from = offset;
      const to = offset + pageSize - 1;
      const endpoint = `${SAFE_DATA_API_BASE_URL}/wpra_athletes?select=contestant_id,first_name,last_name,hometown,photo_url&order=contestant_id.asc`;

      const headers = {
        Accept: "application/json",
        Range: `${from}-${to}`,
      };
      applyDataApiAuthHeaders(headers);
      const response = await fetch(endpoint, { headers });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Neon athlete lookup failed (${response.status}): ${body}`,
        );
      }

      const page = await response.json();
      athletes.push(...page);

      if (page.length < pageSize) break;
    }
  }

  const byFullKey = new Map();
  const byNameKey = new Map();

  for (const athlete of athletes) {
    if (!Number.isFinite(athlete.contestant_id)) continue;

    const fullKey = makeAthleteFullKey(
      athlete.first_name,
      athlete.last_name,
      athlete.hometown,
    );
    const nameKey = makeAthleteNameKey(athlete.first_name, athlete.last_name);

    byFullKey.set(fullKey, {
      contestant_id: athlete.contestant_id,
      photo_url: athlete.photo_url || null,
    });

    const existingNameMatch = byNameKey.get(nameKey);
    if (!existingNameMatch) {
      byNameKey.set(nameKey, {
        contestant_id: athlete.contestant_id,
        photo_url: athlete.photo_url || null,
        ambiguous: false,
      });
    } else if (existingNameMatch.contestant_id !== athlete.contestant_id) {
      byNameKey.set(nameKey, {
        contestant_id: null,
        photo_url: null,
        ambiguous: true,
      });
    }
  }

  console.log(
    `\n👤 Loaded ${athletes.length} WPRA athlete records for contestant_id matching.`,
  );

  return {
    byFullKey,
    byNameKey,
  };
}

function findAthleteForStanding(row, athleteLookup) {
  if (!athleteLookup) return null;

  const fullKey = makeAthleteFullKey(
    row.first_name,
    row.last_name,
    row.hometown,
  );
  const fullMatch = athleteLookup.byFullKey.get(fullKey);
  if (fullMatch && Number.isFinite(fullMatch.contestant_id)) return fullMatch;

  const nameKey = makeAthleteNameKey(row.first_name, row.last_name);
  const nameMatch = athleteLookup.byNameKey.get(nameKey);
  if (
    nameMatch &&
    !nameMatch.ambiguous &&
    Number.isFinite(nameMatch.contestant_id)
  ) {
    return nameMatch;
  }

  return null;
}

function enrichRowsWithContestantIds(rows, athleteLookup) {
  let matched = 0;
  let unmatched = 0;

  const enriched = rows.map((row) => {
    const athlete = findAthleteForStanding(row, athleteLookup);
    if (athlete && Number.isFinite(athlete.contestant_id)) matched++;
    else unmatched++;

    const enrichedRow = {
      ...row,
      contestant_id:
        athlete && Number.isFinite(athlete.contestant_id)
          ? athlete.contestant_id
          : null,
      photo_url: athlete?.photo_url || row.photo_url || null,
    };

    return {
      ...enrichedRow,
      id: makeStandingsId(enrichedRow),
    };
  });

  if (rows.length) {
    console.log(
      `\n🔗 Contestant ID matches: ${matched}/${rows.length}; unmatched or ambiguous: ${unmatched}`,
    );
  }

  return enriched;
}

async function upsertSupabaseRows(filename, payload, athleteLookup) {
  const rows = dedupeSupabaseRows(
    enrichRowsWithContestantIds(
      buildSupabaseRows(filename, payload).filter(
        (row) => Number.isFinite(row.place) && row.place > 0,
      ),
      athleteLookup,
    ),
  );
  if (!rows.length) return;

  const placeFallbackRows = enrichRowsWithContestantIds(
    buildSupabaseRows(filename, payload).filter(
      (row) => Number.isFinite(row.place) && row.place > 0,
    ),
    athleteLookup,
  );
  const dedupedPlaceFallbackRows = [
    ...new Map(
      placeFallbackRows.map((row) => [
        [
          row.season_year,
          row.event,
          row.type,
          row.circuit_id ?? -1,
          row.place,
        ].join("|"),
        row,
      ]),
    ).values(),
  ];

  if (sql) {
    for (const row of rows) {
      await sql`
        insert into public.standings (
          id,
          season_year,
          event,
          type,
          circuit_id,
          contestant_id,
          photo_url,
          place,
          first_name,
          last_name,
          hometown,
          earnings,
          points,
          updated_at
        ) values (
          ${row.id},
          ${row.season_year},
          ${row.event},
          ${row.type},
          ${row.circuit_id},
          ${row.contestant_id},
          ${row.photo_url},
          ${row.place},
          ${row.first_name},
          ${row.last_name},
          ${row.hometown},
          ${row.earnings},
          ${row.points},
          ${row.updated_at}
        )
        on conflict (id) do update set
          season_year = excluded.season_year,
          event = excluded.event,
          type = excluded.type,
          circuit_id = excluded.circuit_id,
          contestant_id = excluded.contestant_id,
          photo_url = excluded.photo_url,
          place = excluded.place,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          hometown = excluded.hometown,
          earnings = excluded.earnings,
          points = excluded.points,
          updated_at = excluded.updated_at
      `;
    }
    return;
  }

  if (!SAFE_DATA_API_BASE_URL) return;

  const makeRequest = async (onConflict) =>
    (async () => {
      const headers = {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      };
      applyDataApiAuthHeaders(headers);
      return fetch(`${SAFE_DATA_API_BASE_URL}/standings?on_conflict=${onConflict}`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          onConflict.includes("contestant_key")
            ? rows
            : dedupedPlaceFallbackRows,
        ),
      });
    })();

  let response = await makeRequest("id");

  if (response.status === 400) {
    const body = await response.text();
    if (
      body.includes('"id"') ||
      body.includes("there is no unique or exclusion constraint")
    ) {
      // Backward compatibility: allow runs before the id-based upsert migration is applied.
      response = await makeRequest(
        "season_year,event,type,circuit_id_key,contestant_key",
      );
    } else if (body.includes('"contestant_key" does not exist')) {
      // Backward compatibility: allow runs before the contestant_key migration is applied.
      response = await makeRequest(
        "season_year,event,type,circuit_id_key,place",
      );
    } else {
      throw new Error(`Neon upsert failed (${response.status}): ${body}`);
    }
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Neon upsert failed (${response.status}): ${body}`);
  }
}

// ---- Scraper ----
async function getWpra(event, type, year, circuit) {
  const currentYear = new Date().getFullYear();
  const circuitName = decodeURIComponent(circuit || "")
    .toLowerCase()
    .trim();
  const modernCircuitSlug = circuitName.toLowerCase().replace(/\s+/g, "-");
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
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
    const LastName =
      name[0] === "Brittany" && name[1] === "Pozzi" && name[2] === "Tonozzi"
        ? "Pozzi Tonozzi"
        : name[name.length - 1];
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
  const athleteLookup = await fetchWpraAthleteLookup();

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
            const normalized = writeNormalizedPayload(filename, {
              error,
              data,
            });
            await upsertSupabaseRows(filename, normalized, athleteLookup);
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
          await upsertSupabaseRows(filename, normalized, athleteLookup);
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
