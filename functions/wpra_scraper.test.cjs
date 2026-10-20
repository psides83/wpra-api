const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const cheerio = require('cheerio');
const { getWpra, selectSeasonTable, getActiveSeasonYear, isExpectedEmptyStandings } = require('./wpra_scraper.cjs');

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

test('unpublished next-season tables can be skipped even during a forced refresh', async (t) => {
  const original = axios.get;
  t.after(() => { axios.get = original; });
  axios.get = async () => ({ status: 200, data:
    '<table class="wpra-standings-table" id="2027-Rookie-Standings-table"><tr><th>Rank</th><th>Name</th></tr></table>' });
  const result = await getWpra('GB', 'rookie', 2027);
  assert.equal(result.unpublished, true);
  assert.equal(isExpectedEmptyStandings(result, 2027, 2026), true);
  assert.equal(isExpectedEmptyStandings(result, 2027, 2027), false);
  assert.equal(isExpectedEmptyStandings({ ...result, error: 'HTTP 500' }, 2027, 2026), false);
  // Rows present but unparseable must still be treated as a failure.
  assert.equal(isExpectedEmptyStandings({ ...result, unpublished: false }, 2027, 2026), false);
});

test('Neon-only runner skips loaded history and unpublished 2027 tables', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const inserts = [];
  const requests = [];
  const history = [];
  for (let year = 2014; year <= 2025; year++) {
    for (const event of ['GB', 'LB']) {
      for (const type of ['world', 'rookie', 'circuit']) {
        for (const circuit_id of type === 'circuit' ? Array.from({length: 13}, (_, i) => i + 1) : [null]) {
          history.push({ season_year: year, event, type, circuit_id });
        }
      }
    }
  }
  const fakeSql = async (parts, ...values) => {
    const query = parts.join('?');
    if (query.includes('select distinct')) return history;
    if (query.includes('from public.wpra_athletes')) return [];
    assert.match(query, /insert into public.wpra_standings/);
    inserts.push(values);
    return [];
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-19T20:00:00Z'])); }
  }
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === '@neondatabase/serverless') return { neon: () => fakeSql };
      if (name === 'axios') return { get: async (url) => {
        const parsed = new URL(url);
        const year = Number(parsed.searchParams.get('standingYear'));
        assert.ok(year === 2026 || year === 2027, 'loaded historical groups must be skipped');
        requests.push(url);
        const emptyRookie = year === 2027 && parsed.pathname.includes('rookie');
        return { status: 200, data: emptyRookie
          ? `<table class="wpra-standings-table" id="${year}-Rookie-Standings-table"><tr><th>Rank</th></tr></table>`
          : page(year) };
      }};
      return require(name);
    },
    process: { env: { NEON_DATABASE_URL: 'mock', WPRA_SEASON_YEAR: '2027', WPRA_REFRESH_YEARS: '2026,2027' }, stdout: { write() {} } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback) { callback(); },
    Date: FixedDate,
    URLSearchParams,
  };
  const source = fs.readFileSync(require.resolve('./wpra_scraper.cjs'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.runAll = runAll;', context);
  await context.module.exports.runAll();
  assert.equal(requests.length, 60);
  assert.equal(inserts.length, 58, 'two unpublished rookie tables must not write to Neon');
  assert.deepEqual([...new Set(inserts.map(values => values[1]))].sort(), [2026, 2027]);
  assert.ok(inserts.every(values => values[4] === null || (values[4] >= 1 && values[4] <= 13)));
});
