// The election runs while Kyiv observes UTC+03:00 (29 Sep–2 Oct 2026).
const KYIV_OFFSET = '+03:00';
const LINE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) ID=(\d+) IP=\S+ VOTES=(\d+(?:,\d+)*) HASH=[a-fA-F0-9]{64}$/;

export function parseReport(text) {
  if (typeof text !== 'string') throw new TypeError('Report must be text');

  const records = [];
  const rejected = [];
  const seenIds = new Set();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const match = LINE.exec(line);
    if (!match) {
      rejected.push(index + 1);
      continue;
    }

    const id = Number(match[2]);
    const time = Date.parse(`${match[1].replace(' ', 'T')}${KYIV_OFFSET}`);
    const votes = match[3].split(',').map(Number);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(time) ||
        votes.length > 9 || votes.some(vote => !Number.isInteger(vote) || vote < 1 || vote > 27) ||
        new Set(votes).size !== votes.length || seenIds.has(id)) {
      rejected.push(index + 1);
      continue;
    }

    seenIds.add(id);
    records.push({ id, time, votes });
  }

  records.sort((a, b) => a.time - b.time || a.id - b.id);
  return { records, rejected };
}

export function summarize(records, candidateCount = 27) {
  const counts = Array(candidateCount + 1).fill(0);
  const lastHour = Array(candidateCount + 1).fill(0);
  const latestTime = records.at(-1)?.time ?? null;
  let selections = 0;

  for (const record of records) {
    for (const vote of record.votes) {
      counts[vote] += 1;
      selections += 1;
      if (latestTime !== null && record.time > latestTime - 3_600_000) lastHour[vote] += 1;
    }
  }

  return { counts, lastHour, latestTime, ballots: records.length, selections };
}

export const TREND_BUCKET_MS = Object.freeze({
  total: Object.freeze({ '6h': 300_000, '24h': 900_000, all: 3_600_000 }),
  pace: Object.freeze({ '6h': 900_000, '24h': 3_600_000, all: 10_800_000 }),
});

export function trendBucketMs(range, mode) {
  const bucketMs = TREND_BUCKET_MS[mode]?.[range];
  if (!Number.isSafeInteger(bucketMs) || bucketMs <= 0) throw new RangeError('Unsupported trend range/mode');
  return bucketMs;
}

export function trend(records, candidateIds, startTime, bucketMs) {
  const selected = new Set(candidateIds);
  const totals = new Map(candidateIds.map(id => [id, 0]));
  const emptyIncrements = () => new Map(candidateIds.map(id => [id, 0]));
  const points = [];
  let nextBucket = Math.floor(startTime / bucketMs) * bucketMs + bucketMs;
  let increments = emptyIncrements();
  let latestTime = null;

  for (const record of records) {
    if (record.time < startTime) {
      for (const id of record.votes) if (selected.has(id)) totals.set(id, totals.get(id) + 1);
      continue;
    }

    if (!points.length) {
      const baselineTime = record.time === startTime ? startTime - 1 : startTime;
      points.push({ time: baselineTime, values: new Map(totals), increments: emptyIncrements() });
    }
    while (record.time >= nextBucket) {
      points.push({ time: nextBucket, values: new Map(totals), increments });
      increments = emptyIncrements();
      nextBucket += bucketMs;
    }
    for (const id of record.votes) if (selected.has(id)) {
      totals.set(id, totals.get(id) + 1);
      increments.set(id, increments.get(id) + 1);
    }
    latestTime = record.time;
  }

  if (latestTime !== null) points.push({ time: latestTime, values: new Map(totals), increments });
  return points;
}
