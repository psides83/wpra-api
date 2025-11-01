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
  MEXICO: { title: "Mexico", id: 14 },
  BRAZIL: { title: "Brazil", id: 15 },
};

const outputDir = "/Users/Payton/web-development/rodeo-daily-resources/wpra"; // or /Users/Payton/Documents/WPRA/
const filePath = `${outputDir}/BR-world-2025.json`;

// const DATA_DIR = path.join(__dirname, "wpra");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const DELAY_MS = 3000;

// ---- Original getWpra function unchanged ----
async function getWpra(event, type, year, circuit) {
  function url() {
    if (event === EVENTS.GB && type === TYPE.WORLD)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo%20-%20World&season=${year}&standing=${year}%20Pro%20Rodeo%20World%20Standings`;
    if (event === EVENTS.GB && type === TYPE.ROOKIE)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Rookie%20Standings&season=${year}&standing=${year}%20Rookie%20Standings`;
    if (event === EVENTS.GB && type === TYPE.CIRCUIT)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo-Circuit&season=${year}&standing=${year}%20Pro%20Rodeo%20${circuit}%20Circuit%20Standings`;
    if (event === EVENTS.LB && type === TYPE.WORLD)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Pro%20Rodeo%20Breakaway%20World%20Standings`;
    if (event === EVENTS.LB && type === TYPE.CIRCUIT)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Pro%20Rodeo%20Breakaway%20${circuit}%20Circuit%20Standings`;
    return null;
  }

  const targetUrl = url();
  if (!targetUrl) return { error: "Invalid params", data: [] };

  const response = await axios.get(targetUrl);
  const html = response.data;
  const $ = cheerio.load(html);
  const table = $("table");
  const rows = table.find("tr");
  let rawData = [];

  rows.each((i, row) => {
    const rankRaw = $(row).find("td:nth-child(1)").text();
    const Place = Number(rankRaw.replace(" (T)", ""));
    const nameRaw = $(row).find("td:nth-child(2)").text();
    const name = nameRaw.split(" ").filter((name) => !name.includes("("));
    const FirstName = name[0];
    const LastName = name[name.length - 1];
    const Hometown = $(row).find("td:nth-child(3)").text();
    const earningsRaw = $(row).find("td:nth-child(4)").text();
    const Earnings = parseFloat(earningsRaw.replace(/,/g, "").replace("$", ""));
    const Event = "GB";
    const Type = "world";
    const Points = Earnings;
    const SeasonYear = Number(year);
    const StandingId = 0;
    const ContestantId = 0;

    if (name) {
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
    }
  });

  const data = rawData.slice(1, 51).filter((position) => position.Place !== 0);
  return { error: null, data };
}

// ---- delay helper ----
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- runner ----
async function runAll() {
  const currentYear = new Date().getFullYear();
  const startYearDefault = 2014;
  const lbStartYear = 2020;
  const circuits = Object.values(CIRCUITS);
  const events = Object.values(EVENTS);
  const types = Object.values(TYPE);

  for (const event of events) {
    const startYear = event === EVENTS.LB ? lbStartYear : startYearDefault;

    for (const type of types) {
      if (type === TYPE.CIRCUIT) {
        for (const circuit of circuits) {
          for (let year = startYear; year <= currentYear; year++) {
            const filename = path.join(
              outputDir,
              `standings?year=${year}&type=${type}&id=${circuit.id}&event=${event}.json`
            );

            if (year !== currentYear && fs.existsSync(filename)) {
              console.log(`⏭️ Skipping existing: ${filename}`);
              continue;
            }

            const { error, data } = await getWpra(
              event,
              type,
              year,
              circuit.title
            );
            fs.writeFileSync(
              filename,
              JSON.stringify({ error, data }, null, 2),
              "utf-8"
            );
            console.log(`✅ Saved: ${filename}`);
            await delay(DELAY_MS);
          }
        }
      } else {
        for (let year = startYear; year <= currentYear; year++) {
          const filename = path.join(
            outputDir,
            `standings?year=${year}&type=${type}&id=&event=${event}.json`
          );

          if (year !== currentYear && fs.existsSync(filename)) {
            console.log(`⏭️ Skipping existing: ${filename}`);
            continue;
          }

          const { error, data } = await getWpra(event, type, year);
          fs.writeFileSync(
            filename,
            JSON.stringify({ error, data }, null, 2),
            "utf-8"
          );
          console.log(`✅ Saved: ${filename}`);
          await delay(DELAY_MS);
        }
      }
    }
  }

  console.log("🏁 All scraping complete!");
}

// ---- run ----
runAll().catch(console.error);
