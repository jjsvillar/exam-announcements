import assert from 'node:assert/strict';
import {
    formatCurrentTime,
    formatExamTimeRemaining,
    getExamTimeUrgency
} from '../src/lib/time-format.js';

const minute = 60_000;

/** @type {Array<[number, string, string]>} */
const countdownCases = [
    [121 * minute, '02:30:00', 'more than one hour rounds to 30 minutes'],
    [60 * minute, '01:00:00', 'last hour rounds to 10 minutes'],
    [51 * minute, '01:00:00', 'last hour advances in 10-minute steps'],
    [30 * minute, '00:30:00', 'last 30 minutes rounds to 5 minutes'],
    [26 * minute, '00:30:00', 'last 30 minutes advances in 5-minute steps'],
    [10 * minute, '00:10:00', 'last 10 minutes rounds to one minute'],
    [9 * minute + 1, '00:10:00', 'last 10 minutes advances each minute'],
    [5 * minute, '00:05:00', 'last five minutes shows seconds'],
    [4 * minute + 37_000, '00:04:37', 'last five minutes preserves seconds']
];

for (const [milliseconds, expected, label] of countdownCases) {
    assert.equal(formatExamTimeRemaining(milliseconds), expected, label);
}

/** @type {Array<[number | null, string, string]>} */
const urgencyCases = [
    [61 * minute, 'normal', 'above one hour uses the default color'],
    [60 * minute, 'yellow', 'the last hour is yellow'],
    [30 * minute, 'orange', 'the last 30 minutes are orange'],
    [5 * minute, 'red', 'the last five minutes are red'],
    [null, 'normal', 'an unset end time uses the default color']
];

for (const [milliseconds, expected, label] of urgencyCases) {
    assert.equal(getExamTimeUrgency(milliseconds), expected, label);
}

const afternoon = new Date(2026, 0, 1, 13, 5).getTime();
assert.equal(formatCurrentTime(afternoon), '01:05 PM');

console.log('Time formatting tests passed.');
