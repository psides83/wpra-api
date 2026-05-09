#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.resolve(process.cwd(), "wpra_athletes.csv");
const OUTPUT_FILE = path.resolve(process.cwd(), "wpra_athletes_with_name.csv");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (!/[",\n\r]/.test(str)) return str;

  return `"${str.replaceAll('"', '""')}"`;
}

function main() {
  const raw = fs.readFileSync(INPUT_FILE, "utf-8").trim();
  const lines = raw.split(/\r?\n/);

  const headers = parseCsvLine(lines[0]);
  const firstNameIndex = headers.indexOf("first_name");
  const lastNameIndex = headers.indexOf("last_name");

  if (firstNameIndex === -1 || lastNameIndex === -1) {
    throw new Error("CSV must include first_name and last_name columns.");
  }

  const newHeaders = [
    "contestant_id",
    "name",
    "first_name",
    "last_name",
    "nick_name",
    "hometown",
  ];

  const outputLines = [newHeaders.join(",")];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const values = parseCsvLine(line);

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();

    const newRow = {
      contestant_id: row.contestant_id,
      name,
      first_name: row.first_name,
      last_name: row.last_name,
      nick_name: row.nick_name,
      hometown: row.hometown,
    };

    outputLines.push(
      newHeaders.map((header) => csvEscape(newRow[header])).join(","),
    );
  }

  fs.writeFileSync(OUTPUT_FILE, `${outputLines.join("\n")}\n`, "utf-8");

  console.log(`Created ${OUTPUT_FILE}`);
}

main();
