import axios from "axios";
import cheerio from "cheerio";
import moment from "moment";

const EVENTS = {
  BR: "br",
  LB: "lb",
};

const TYPE = {
  WORLD: "world",
  ROOKIE: "rookie",
  CIRCUIT: "circuit",
};

const CIRCUITS = {
  BADLANDS: "Badlands",
  CALIFORNIA: "California",
  COLUMBIA_RIVER: "Columbia%20River",
  FIRST_FRONTIER: "First%20Frontier",
  GREAT_LAKES: "Great%20Lakes",
  MAPLE_LEAF: "Maple%20Leaf",
  MONTANA: "Montana",
  MOUNTAIN_STATES: "Mountain%20States",
  PRAIRIE: "Prairie",
  SOUTHEASTERN: "Southeastern",
  TEXAS: "Texas",
  TURQUOISE: "Turquoise",
  WILDERNESS: "Wilderness",
  MEXICO: "Mexico",
  BRAZIL: "Brazil",
};

export default async function getWpra(event, type, year, circuit) {
  function url() {
    if (event === EVENTS.BR && type === TYPE.WORLD)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo%20-%20World&season=${year}&standing=${year}%20Pro%20Rodeo%20World%20Standings`;
    if (event === EVENTS.BR && type === TYPE.ROOKIE)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Rookie%20Standings&season=${year}&standing=${year}%20Rookie%20Standings`;
    if (event === EVENTS.BR && type === TYPE.CIRCUIT)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Pro%20Rodeo-Circuit&season=${year}&standing=${year}%20Pro%20Rodeo%20${circuit}%20Circuit%20Standings`;
    if (event === EVENTS.LB && type === TYPE.WORLD)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Pro%20Rodeo%20Breakaway%20World%20Standings`;
    if (event === EVENTS.LB && type === TYPE.CIRCUIT)
      return `https://archived.wpra.com/index.php/standings-group-season?group=Roping%20Standings&season=${year}&standing=${year}%20Breakaway%20${circuit}%20Circuit%20Standings`;
  }

  console.log(event, type, year);
  const response = await axios.get(url());
  const html = response.data;

  // Load the HTML into Cheerio
  const $ = cheerio.load(html);

  // Find the table in the HTML
  const table = $("table");

  // Find the rows in the table
  const rows = table.find("tr");
  console.log(table);

  var rawData = [];

  // Iterate over the rows and get the values from the 1st and 9th columns
  rows.each((i, row) => {
    const rankRaw = $(row).find("td:nth-child(1)").text();
    const Place = Number(rankRaw);
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

  const data = rawData.slice(1, 51);

  const error = null;

  return { error, data };
}
