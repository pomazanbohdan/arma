import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseReport, summarize } from '../public/report.mjs';

const source = 'https://voting.arma.gov.ua/voting/public/hashed_report.txt';
const publishedMeta = 'https://pomazanbohdan.github.io/arma/data/meta.json';
const directory = fileURLToPath(new URL('../public/data/', import.meta.url));

async function fetchReport() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${source}?v=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function isAlreadyPublished(hash) {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') return false;
  try {
    const response = await fetch(`${publishedMeta}?v=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok && (await response.json()).sha256 === hash;
  } catch {
    return false;
  }
}

async function setChanged(changed) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

const raw = await fetchReport();
const hash = createHash('sha256').update(raw).digest('hex');
if (await isAlreadyPublished(hash)) {
  await setChanged(false);
  console.log('Report unchanged; deployment skipped.');
} else {
  const parsed = parseReport(raw);
  if (parsed.records.length === 0 || parsed.rejected.length > 0) {
    throw new Error(`Report rejected: ${parsed.records.length} valid, ${parsed.rejected.length} invalid lines`);
  }
  const summary = summarize(parsed.records);
  const meta = {
    fetchedAt: new Date().toISOString(),
    recordCount: summary.ballots,
    latestRecordAt: new Date(summary.latestTime).toISOString(),
    sha256: hash,
    source,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('../public/data/hashed_report.txt', import.meta.url), raw, 'utf8');
  await writeFile(new URL('../public/data/meta.json', import.meta.url), `${JSON.stringify(meta)}\n`, 'utf8');
  await setChanged(true);
  console.log(`Prepared ${summary.ballots} records, ${summary.selections} candidate votes; latest ${meta.latestRecordAt}`);
}
