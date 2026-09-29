import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseReport, summarize } from '../public/report.mjs';

const source = 'https://voting.arma.gov.ua/voting/public/hashed_report.txt';
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

const raw = await fetchReport();
const parsed = parseReport(raw);
if (parsed.records.length === 0 || parsed.rejected.length > 0) {
  throw new Error(`Report rejected: ${parsed.records.length} valid, ${parsed.rejected.length} invalid lines`);
}
const summary = summarize(parsed.records);
const meta = {
  fetchedAt: new Date().toISOString(),
  recordCount: summary.ballots,
  latestRecordAt: new Date(summary.latestTime).toISOString(),
  sha256: createHash('sha256').update(raw).digest('hex'),
  source,
};
await mkdir(directory, { recursive: true });
await writeFile(new URL('../public/data/hashed_report.txt', import.meta.url), raw, 'utf8');
await writeFile(new URL('../public/data/meta.json', import.meta.url), `${JSON.stringify(meta)}\n`, 'utf8');
console.log(`Prepared ${summary.ballots} records, ${summary.selections} candidate votes; latest ${meta.latestRecordAt}`);
