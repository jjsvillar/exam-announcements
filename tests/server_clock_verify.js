import assert from 'node:assert/strict';
import { createServerClock } from '../src/lib/server-clock.js';
import { formatCurrentTime, formatDuration } from '../src/lib/time-format.js';

let monotonic = 100;
let browserWallClock = -999_999_999;
let attempts = 0;
const clock = createServerClock(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary outage');
    monotonic += 40;
    return { timestamp: Date.parse('2026-01-01T13:05:00Z'), timeZone: 'Asia/Manila' };
}, () => monotonic);

assert.equal(clock.now(), null, 'no browser-clock fallback before first sync');
await assert.rejects(clock.sync(), /temporary outage/);
assert.equal(clock.now(), null, 'initial failure stays unsynchronized');
assert.equal(clock.timeZone, null);
await clock.sync();
const syncedNow = clock.now();
if (syncedNow === null) throw new Error('clock did not synchronize');
assert.equal(syncedNow, Date.parse('2026-01-01T13:05:00Z') + 20);
assert.equal(formatCurrentTime(syncedNow, clock.timeZone ?? undefined), '09:05 PM');
assert.equal(formatCurrentTime(Date.parse('2026-01-01T13:05:00Z'), 'America/New_York'), '08:05 AM');
const start = Date.parse('2026-01-01T13:06:00Z');
const end = Date.parse('2026-01-01T13:07:00Z');
assert.equal(formatDuration(Math.max(0, start - syncedNow)), '00:00:59');
monotonic += 60_000;
browserWallClock += 400_000_000;
const startedNow = clock.now();
if (startedNow === null) throw new Error('clock lost its host sample');
assert.equal(startedNow, Date.parse('2026-01-01T13:06:00Z') + 20);
assert.equal(start <= startedNow, true, 'exam begins on host instant');
assert.equal(formatDuration(Math.max(0, end - startedNow)), '00:00:59');
assert.equal(browserWallClock < 0, true, 'browser wall clock remains unrelated');
await clock.sync();
assert.equal(attempts, 3, 'periodic resync can replace the anchor');
assert.equal(clock.now(), Date.parse('2026-01-01T13:05:00Z') + 20);

let finishRequest = () => {};
const deferred = new Promise((resolve) => {
    finishRequest = () => resolve({ timestamp: 1_000, timeZone: 'UTC' });
});
let fetches = 0;
const overlapping = createServerClock(async () => {
    fetches += 1;
    return deferred;
}, () => monotonic);
const firstSync = overlapping.sync();
const secondSync = overlapping.sync();
assert.equal(firstSync, secondSync, 'overlapping resyncs share one request');
assert.equal(fetches, 1);
finishRequest();
await firstSync;
assert.equal(overlapping.now(), 1_000);

const invalid = createServerClock(async () => ({ timestamp: NaN, timeZone: 'UTC' }), () => monotonic);
await assert.rejects(invalid.sync(), /Invalid host time response/);
assert.equal(invalid.now(), null);
console.log('Server clock tests passed.');
