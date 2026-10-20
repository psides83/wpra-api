const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const cheerio = require('cheerio');
const { getWpra, selectSeasonTable, getActiveSeasonYear } = require('./wpra_scraper.cjs');

function page(year, name = 'Correct Rider') {
  return `<nav>2026 Rookie Standings</nav><table><tr><td>1</td><td>Wrong Rider</td><td>TX</td><td>999</td></tr></table>
    <table class="wpra-standings-table" id="${year}-Pro-Rodeo-World-Standings-table"><tr><td>1</td><td>${name}</td><td>TX</td><td>$123.45</td></tr></table>`;
}

test('rejects wrong or unidentifiable table seasons despite navigation years', () => {
  assert.throws(() => selectSeasonTable(cheerio.load(page(2027)), 2026), /Season mismatch/);
  assert.throws(() => selectSeasonTable(cheerio.load('<table></table>'), 2026), /No season-labelled/);
  assert.throws(() => selectSeasonTable(cheerio.load(page(2026) + page(2027)), 2026), /Season mismatch/);
});

test('explicit season and service for both events and all standings categories', async (t) => {
  const original = axios.get;
  t.after(() => { axios.get = original; });
  for (const year of [2026, 2027]) {
    for (const event of ['GB', 'LB']) {
      for (const type of ['world', 'rookie', 'circuit']) {
        axios.get = async (url) => {
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get('standingYear'), String(year));
          const suffix = type === 'circuit' ? 'tx' : `world${type === 'rookie' ? '-rk' : ''}`;
          assert.equal(parsed.searchParams.get('svcUrl'), `pro-${event === 'GB' ? 'gb' : 'lbk'}-${suffix}`);
          return { status: 200, data: page(year) + page(year, 'Duplicate Rider') };
        };
        const result = await getWpra(event, type, year, 'Texas');
        assert.equal(result.data.length, 1);
        assert.equal(result.data[0].FirstName, 'Correct');
        assert.equal(result.data[0].SeasonYear, year);
      }
    }
  }
  axios.get = async () => ({ status: 200, data: page(2027) });
  assert.equal(await getActiveSeasonYear(), 2027);
  await assert.rejects(() => getWpra('GB', 'world', 2026), /Season mismatch/);
});
