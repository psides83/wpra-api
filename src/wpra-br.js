import axios from "axios";
import cheerio from "cheerio";

export default async function getWpraBr() {
  const url = "https://www.wpra.com/standings-pro-rodeo-world/";
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
    const rank = $(row).find("td:nth-child(1)").text();
    const name = $(row).find("td:nth-child(2)").text();
    const hometown = $(row).find("td:nth-child(3)").text();
    const earnings = $(row).find("td:nth-child(4)").text();

    if (name) {
      standings.push({ rank, name, hometown, earnings });
    }
  });

  return standings;
}
