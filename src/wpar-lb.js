import axios from "axios";
import cheerio from "cheerio";
import moment from "moment";

export default async function getWpraLb() {
  const url = "https://www.wpra.com/standings-pro-rodeo-breakaway-world/";
  const response = await axios.get(url);
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
    const Event = "LB";
    const Type = "world";
    const Points = Earnings;
    const SeasonYear = Number(moment().format("yyyy"));
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
