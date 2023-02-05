const PORT = process.env.PORT || 8000;
import express from "express";
import getWpraBr from "./src/wpra.js";

const app = express();

const standings = await getWpraBr();

console.log(standings);

app.get("/wpra-br", (req, res) => {
  res.json(standings);
});

// todo PORT running
app.listen(PORT, () => console.log(`server running on port: ${PORT}`));
