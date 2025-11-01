const functions = require("firebase-functions");
const express = require("express");
const wpra = require("./wpra");

const app = express();
const getWpra = wpra.getWpra;

// get wrpa standings
app.get("/:event/:type/:year/:circuit?", async (req, res) => {
  const { event, type, year, circuit } = req.params;

  const standings = await getWpra(event, type, year, circuit);

  res.send(standings);
});

exports.wpra = functions.https.onRequest(app);
