import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseReport, summarize, trend, trendBucketMs } from '../public/report.mjs';

const line = (time, id, votes) => `${time} ID=${id} IP=masked VOTES=${votes} HASH=${'a'.repeat(64)}`;

test('uses independent sampling periods for accumulated votes and changes', () => {
  const expected = [
    ['6h', 300_000, 900_000],
    ['24h', 900_000, 3_600_000],
    ['all', 3_600_000, 10_800_000],
  ];
  for (const [range, totalMs, paceMs] of expected) {
    assert.equal(trendBucketMs(range, 'total'), totalMs);
    assert.equal(trendBucketMs(range, 'pace'), paceMs);
  }
  assert.throws(() => trendBucketMs('7d', 'total'), RangeError);
  assert.throws(() => trendBucketMs('6h', 'toString'), RangeError);
});

test('coarse all-time trends keep an explicit zero point before the first vote', () => {
  const records = parseReport([
    line('2026-09-29 09:02:37.023', 1, '3'),
    line('2026-09-29 09:04:11.695', 2, '5'),
  ].join('\n')).records;
  const first = records[0].time;
  for (const mode of ['total', 'pace']) {
    const points = trend(records, [3, 5], first, trendBucketMs('all', mode));
    assert.equal(points[0].time, first - 1);
    assert.deepEqual([...points[0].values.values()], [0, 0]);
    assert.deepEqual([...points[0].increments.values()], [0, 0]);
    assert.deepEqual([...points.at(-1).values.values()], [1, 1]);
    assert.deepEqual([...points.at(-1).increments.values()], [1, 1]);
  }
});

test('sorts late-arriving rows and counts each choice once', () => {
  const raw = [
    line('2026-09-29 09:10:00.000', 2, '3,5'),
    line('2026-09-29 09:00:00.000', 1, '3'),
  ].join('\n');
  const parsed = parseReport(raw);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(parsed.records.map(record => record.id), [1, 2]);
  assert.equal(parsed.records[0].time, Date.parse('2026-09-29T09:00:00.000+03:00'));
  const summary = summarize(parsed.records);
  assert.equal(summary.ballots, 2);
  assert.equal(summary.selections, 3);
  assert.equal(summary.counts[3], 2);
  assert.equal(summary.counts[5], 1);
});

test('rejects duplicate records and invalid ballots', () => {
  const parsed = parseReport([
    line('2026-09-29 09:00:00.000', 1, '3,5'),
    line('2026-09-29 09:01:00.000', 1, '3'),
    line('2026-09-29 09:02:00.000', 2, '3,3'),
    line('2026-09-29 09:03:00.000', 3, '28'),
    line('2026-09-29 09:04:00.000', 4, '1,2,3,4,5,6,7,8,9,10'),
  ].join('\n'));
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.rejected, [2, 3, 4, 5]);
});

test('trend keeps baseline but interval counts only new choices', () => {
  const records = parseReport([
    line('2026-09-29 09:00:00.000', 1, '3'),
    line('2026-09-29 09:07:00.000', 2, '3,5'),
    line('2026-09-29 09:17:00.000', 3, '5'),
  ].join('\n')).records;
  const points = trend(records, [3, 5], Date.parse('2026-09-29T09:05:00+03:00'), 300_000);
  assert.equal(points[0].values.get(3), 1);
  assert.equal(points[0].increments.get(3), 0);
  assert.equal(points[1].time, Date.parse('2026-09-29T09:10:00+03:00'));
  assert.equal(points[1].values.get(3), 2);
  assert.equal(points[1].increments.get(3), 1);
  assert.equal(points[2].increments.get(3), 0);
  assert.equal(points.at(-1).values.get(5), 2);
  assert.equal(points.at(-1).increments.get(5), 1);
});

test('all-time trend starts at zero before the first vote and never looks ahead', () => {
  const records = parseReport([
    line('2026-09-29 09:02:37.023', 1, '3'),
    line('2026-09-29 09:04:11.695', 2, '5'),
    line('2026-09-29 09:12:00.000', 3, '3'),
  ].join('\n')).records;
  const points = trend(records, [3, 5], records[0].time, 60_000);
  assert.equal(points[0].time, records[0].time - 1);
  assert.deepEqual([...points[0].values.values()], [0, 0]);
  assert.equal(points[1].time, Date.parse('2026-09-29T09:03:00+03:00'));
  assert.deepEqual([...points[1].values.values()], [1, 0]);
  assert.equal(points[2].time, Date.parse('2026-09-29T09:04:00+03:00'));
  assert.deepEqual([...points[2].increments.values()], [0, 0]);
  assert.deepEqual([...points[3].values.values()], [1, 1]);
  assert.equal(points.at(-1).time, records.at(-1).time);
  assert.deepEqual([...points.at(-1).values.values()], [2, 1]);
});

test('bundled final report matches its manifest and parses completely', async () => {
  const [raw, metaText] = await Promise.all([
    readFile(new URL('../public/data/hashed_report.txt', import.meta.url), 'utf8'),
    readFile(new URL('../public/data/meta.json', import.meta.url), 'utf8'),
  ]);
  const meta = JSON.parse(metaText);
  assert.equal(createHash('sha256').update(raw).digest('hex'), meta.sha256);
  const parsed = parseReport(raw);
  assert.deepEqual(parsed.rejected, []);
  assert.equal(parsed.records.length, meta.recordCount);
  assert.equal(summarize(parsed.records).ballots, meta.recordCount);
});
