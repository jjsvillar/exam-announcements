import assert from 'node:assert/strict';
import {
    formatCurrentTime,
    formatDuration,
    formatExamTimeRemaining,
    getExamTimeUrgency
} from '../src/lib/time-format.js';

const minute = 60_000;

/** @type {Array<[number | null, string, string]>} */
const countdownCases = [
    [null, '--:--:--', 'unset exam end shows a placeholder'],
    [0, '00:00:00', 'expired exam shows zero'],
    [1, '00:01:00', 'positive time below one minute rounds up'],
    [minute - 1, '00:01:00', 'last millisecond below one minute rounds up'],
    [minute, '00:01:00', 'exact minute does not round up'],
    [minute + 1, '00:02:00', 'one millisecond beyond an exact minute rounds up'],
    [4 * minute + 37_000, '00:05:00', 'last five minutes advances each minute'],
    [5 * minute, '00:05:00', 'exact five-minute boundary'],
    [5 * minute + 1, '00:06:00', 'just beyond five minutes'],
    [10 * minute, '00:10:00', 'exact ten-minute boundary'],
    [10 * minute + 1, '00:11:00', 'just beyond ten minutes'],
    [26 * minute, '00:26:00', 'last 30 minutes advances each minute'],
    [30 * minute, '00:30:00', 'exact 30-minute boundary'],
    [30 * minute + 1, '00:31:00', 'just beyond 30 minutes'],
    [51 * minute, '00:51:00', 'last hour advances each minute'],
    [60 * minute, '01:00:00', 'exact one-hour boundary'],
    [60 * minute + 1, '01:01:00', 'just beyond one hour'],
    [121 * minute, '02:01:00', 'multiple hours advance each minute'],
    [121 * minute + 1, '02:02:00', 'partial minute beyond two hours rounds up']
];

for (const [milliseconds, expected, label] of countdownCases) {
    assert.equal(formatExamTimeRemaining(milliseconds), expected, label);
}

/** @type {Array<[number | null, string, string]>} */
const urgencyCases = [
    [61 * minute, 'normal', 'above one hour uses the default color'],
    [60 * minute + 1, 'normal', 'just above one hour uses the default color'],
    [60 * minute, 'yellow', 'the last hour is yellow'],
    [30 * minute + 1, 'yellow', 'just above 30 minutes stays yellow'],
    [30 * minute, 'orange', 'the last 30 minutes are orange'],
    [5 * minute + 1, 'orange', 'just above five minutes stays orange'],
    [5 * minute, 'red', 'the last five minutes are red'],
    [0, 'red', 'expired exams remain red'],
    [null, 'normal', 'an unset end time uses the default color']
];

for (const [milliseconds, expected, label] of urgencyCases) {
    assert.equal(getExamTimeUrgency(milliseconds), expected, label);
}

assert.equal(formatDuration(null), '--:--:--', 'pre-exam placeholder stays unchanged');
assert.equal(formatDuration(4 * minute + 37_000), '00:04:37', 'pre-exam countdown keeps seconds');
assert.equal(formatDuration(0), '00:00:00', 'pre-exam countdown reaches zero');

const afternoon = new Date(2026, 0, 1, 13, 5).getTime();
assert.equal(formatCurrentTime(afternoon), '01:05 PM');

console.log('Time formatting tests passed.');
