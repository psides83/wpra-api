const PORT = process.env.PORT || 8000;
import express from "express";
import getWpraLb from "./src/wpar-lb.js";
import getWpraBr from "./src/wpra-br.js";

const app = express();

const brStandings = await getWpraBr();

app.get("/wpra-br", (req, res) => {
  res.json(brStandings);
});

const lbStandings = await getWpraLb();

app.get("/wpra-lb", (req, res) => {
  res.json(lbStandings);
});

// todo PORT running
app.listen(PORT, () => console.log(`server running on port: ${PORT}`));
