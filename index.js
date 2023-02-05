const PORT = process.env.PORT || 8000;
import express from "express";
import getWpraLb from "./src/wpar-lb.js";
import getWpraBr from "./src/wpra-br.js";

const app = express();

app.get("/wpra-br/:year", async (req, res) => {
  const year = req.params.year;

  const brStandings = await getWpraBr(year);

  res.json(brStandings);
});

app.get("/wpra-lb/:year", async (req, res) => {
  const year = req.params.year;

  const lbStandings = await getWpraLb(year);

  res.json(lbStandings);
});

// todo PORT running
app.listen(PORT, () => console.log(`server running on port: ${PORT}`));
