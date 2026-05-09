#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.resolve(process.cwd(), "last_400_rodeos.json");
const OUTPUT_FILE = path.resolve(process.cwd(), "wpra_athletes.csv");
const DELAY_MS = Number.parseInt(process.env.DELAY_MS || "350", 10);

// GB = Barrel Racing, LB = Ladies Breakaway.
// BR is Bull Riding, so it is intentionally excluded.
const TARGET_EVENT_KEYS = new Set(["GB", "LB"]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (!/[",\n\r]/.test(str)) return str;

  return `"${str.replaceAll('"', '""')}"`;
}

function readRodeoIds(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);

  const data = Array.isArray(json?.data) ? json.data : [];

  const ids = data
    .map((item) => item?.RodeoId)
    .filter((id) => Number.isFinite(id));

  return [...new Set(ids)];
}

function extractContestantsFromResults(payload) {
  const rodeos = Array.isArray(payload?.data) ? payload.data : [];
  const athletes = [];

  for (const rodeo of rodeos) {
    const events = rodeo?.Events || {};

    for (const eventKey of Object.keys(events)) {
      if (!TARGET_EVENT_KEYS.has(eventKey)) continue;

      const rounds = events[eventKey] || {};

      for (const roundKey of Object.keys(rounds)) {
        const entries = Array.isArray(rounds[roundKey]) ? rounds[roundKey] : [];

        for (const entry of entries) {
          const contestants = Array.isArray(entry?.Contestant)
            ? entry.Contestant
            : [];

          for (const c of contestants) {
            if (!Number.isFinite(c?.ContestantId)) continue;

            const firstName = c.FirstName || "";
            const lastName = c.LastName || "";
            const name = `${firstName} ${lastName}`.trim() || null;

            athletes.push({
              contestant_id: c.ContestantId,
              name,
              first_name: firstName || null,
              last_name: lastName || null,
              nick_name: c.NickName || null,
              hometown: c.Hometown || null,
              photo_url: c.PhotoUrl || null,
            });
          }
        }
      }
    }
  }

  return athletes;
}

function dedupeAthletes(rows) {
  const byId = new Map();

  for (const row of rows) {
    byId.set(row.contestant_id, row);
  }

  return [...byId.values()];
}

function writeAthletesCsv(rows, filePath) {
  const headers = [
    "contestant_id",
    "name",
    "first_name",
    "last_name",
    "nick_name",
    "hometown",
    "photo_url",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(","),
    ),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

async function fetchRodeoResults(rodeoId) {
  const url =
    "https://d1kfpvgfupbmyo.cloudfront.net/services/pro_rodeo.ashx/results" +
    `?rodeoid=${rodeoId}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for rodeo ${rodeoId}`);
  }

  return res.json();
}

async function main() {
  const rodeoIds = readRodeoIds(INPUT_FILE);

  console.log(`Found ${rodeoIds.length} unique rodeo IDs.`);

  const allAthletes = [];
  let fetched = 0;
  let skipped = 0;

  for (const rodeoId of rodeoIds) {
    const current = fetched + skipped + 1;
    console.log(`[${current}/${rodeoIds.length}] Fetching rodeo ${rodeoId}...`);

    try {
      const payload = await fetchRodeoResults(rodeoId);
      const athletes = extractContestantsFromResults(payload);

      allAthletes.push(...athletes);
      fetched++;
    } catch (err) {
      skipped++;
      console.warn(`Skipping rodeo ${rodeoId}: ${err.message}`);
    }

    await delay(DELAY_MS);
  }

  const deduped = dedupeAthletes(allAthletes);

  console.log(
    `Fetched ${fetched}/${rodeoIds.length} rodeos, skipped ${skipped}. Extracted ${deduped.length} unique athletes.`,
  );

  writeAthletesCsv(deduped, OUTPUT_FILE);

  console.log(`CSV export complete: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
