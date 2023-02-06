const PORT = process.env.PORT || 8000;
import express from "express";
import getWpra from "./src/wpra.js";

const app = express();

// get wrpa standings
app.get("/:event/:type/:year/:circuit?", async (req, res) => {
  const { event, type, year, circuit } = req.params;

  const standings = await getWpra(event, type, year, circuit);
  console.log(event, type, year, circuit);

  res.json(standings);
});

// todo PORT running
app.listen(PORT, () => console.log(`server running on port: ${PORT}`));
