import axios from "axios";
import cheerio from "cheerio";

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

  var standings = [];

  // Iterate over the rows and get the values from the 1st and 9th columns
  rows.each((i, row) => {
    const rankRaw = $(row).find("td:nth-child(1)").text();
    const place = Number(rankRaw);
    const nameRaw = $(row).find("td:nth-child(2)").text();
    const name = nameRaw.split(" ").filter((name) => !name.includes("("));
    const firstName = name[0];
    const lastName = name[name.length - 1];
    const hometown = $(row).find("td:nth-child(3)").text();
    const earningsRaw = $(row).find("td:nth-child(4)").text();
    const earnings = parseFloat(earningsRaw.replace(/,/g, "").replace("$", ""));

    if (name) {
      standings.push({ place, firstName, lastName, hometown, earnings });
    }
  });

  return standings;
}
