#!/usr/bin/env node
// Network is used only by this explicit maintenance command, never by the app.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = {
  repository: 'https://github.com/mborsetti/airportsdata',
  commit: '47ae282a8491758e6dafe28d4139539e561b54d5',
  commitDate: '2026-09-05',
  csvSha256: '516c57d9d999f7a3be28ca649d2badbe3b972f07e57dc6173ab973b72d51cf52',
  licenseSha256: '1ab6bf365e1f6a1883ab6a2f797e761b221081b52a33273d86c157fd562106be',
};

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/update-airports.mjs [--check] [--source airports.csv] [--license LICENSE]\nPinned MIT source; no dependency install. --check compares generated files without writing them.\nOn Node 24 behind a proxy: NODE_USE_ENV_PROXY=1 node scripts/update-airports.mjs');
  process.exit(0);
}
const options = { check: false, csvPath: undefined, licensePath: undefined };
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--check') options.check = true;
  else if ((arg === '--source' || arg === '--license') && args[index + 1]) {
    options[arg === '--source' ? 'csvPath' : 'licensePath'] = args[++index];
  } else throw new Error(`Unknown or incomplete option: ${arg}`);
}

async function readSource(path, localPath, expectedSha) {
  let bytes;
  if (localPath) bytes = await readFile(resolve(localPath));
  else {
    const url = `https://raw.githubusercontent.com/mborsetti/airportsdata/${source.commit}/${path}`;
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(30_000) }); }
    catch (error) {
      throw new Error(`Cannot fetch pinned source. Use --source/--license for downloaded files, or NODE_USE_ENV_PROXY=1 on Node 24 when behind a proxy. ${error.message}`);
    }
    if (!response.ok) throw new Error(`Source download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== expectedSha) throw new Error(`Pinned-source checksum mismatch for ${path}: ${sha}`);
  return bytes.toString('utf8');
}

// RFC 4180 fields: quoted commas, escaped quotes, and CRLF all occur in source data.
function parseCsv(csv) {
  const records = []; let record = []; let field = ''; let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { record.push(field); field = ''; }
    else if (char === '\n') {
      record.push(field.replace(/\r$/, '')); records.push(record); record = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  if (field || record.length) { record.push(field.replace(/\r$/, '')); records.push(record); }
  const headers = records.shift();
  if (!headers || !['iata', 'name', 'city', 'tz', 'lat', 'lon'].every(key => headers.includes(key))) throw new Error('Unexpected source CSV schema');
  return records.map(values => {
    if (values.length !== headers.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  });
}

async function main() {
  const [csv, license] = await Promise.all([
    readSource('airportsdata/airports.csv', options.csvPath, source.csvSha256),
    readSource('LICENSE', options.licensePath, source.licenseSha256),
  ]);
  const rows = parseCsv(csv); const codes = new Set(); const excluded = []; const checkedZones = new Map();
  const airports = [];
  for (const row of rows) {
    if (!row.iata) continue;
    if (!/^[A-Z]{3}$/.test(row.iata)) throw new Error(`Invalid IATA airport code: ${row.iata}`);
    if (codes.has(row.iata)) throw new Error(`Duplicate IATA airport code: ${row.iata}`);
    codes.add(row.iata);
    if (!row.tz || /^[+-]/.test(row.tz)) { excluded.push({ code: row.iata, timeZone: row.tz, reason: 'Missing or fixed-offset zone' }); continue; }
    if (!checkedZones.has(row.tz)) {
      try { new Intl.DateTimeFormat('en', { timeZone: row.tz }).format(0); checkedZones.set(row.tz, true); }
      catch { checkedZones.set(row.tz, false); }
    }
    if (!checkedZones.get(row.tz)) { excluded.push({ code: row.iata, timeZone: row.tz, reason: 'IANA zone not recognized by generating runtime' }); continue; }
    const latitude = Number(row.lat); const longitude = Number(row.lon);
    if (!row.lat || !row.lon || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error(`Invalid coordinates for ${row.iata}`);
    if (!row.name) throw new Error(`Missing airport name for ${row.iata}`);
    airports.push({ code: row.iata, name: row.name, city: row.city, timeZone: row.tz, latitude, longitude });
  }
  airports.sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  if (airports.length < 7_000) throw new Error('Unexpectedly small airport dataset');
  const data = `${JSON.stringify(airports, null, 2)}\n`;
  const metadata = `${JSON.stringify({ ...source, sourceAirportCount: rows.length, bundledAirportCount: airports.length, excluded, license: 'MIT', transformation: 'IATA airports only; validate zones and coordinates; alphabetical IATA order; no guessed zones' }, null, 2)}\n`;
  const outputs = [
    ['src/lib/airports-data.json', data],
    ['public/data-licenses/airportsdata-LICENSE.txt', license],
    ['public/data-licenses/airportsdata-source.json', metadata],
  ];
  for (const [path, contents] of outputs) {
    const fullPath = resolve(root, path);
    if (options.check) {
      if (await readFile(fullPath, 'utf8') !== contents) throw new Error(`Generated file differs: ${path}`);
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, contents);
    }
  }
  console.log(`${options.check ? 'Verified' : 'Generated'} ${airports.length} IATA airports (${excluded.length} excluded) from ${source.commit}.`);
  if (excluded.length) console.log(JSON.stringify(excluded));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
