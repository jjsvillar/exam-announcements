
/**
 * Verification script for Audio Sync Math
 * 
 * Logic to verify:
 * correctCurrentTime = duration - (timeLeft % duration)
 * 
 * Goal: Audio should end (reach duration) exactly when timeLeft reaches 0 (or a multiple of duration).
 */

function calculateExpectedTime(timeLeftMs, durationSec) {
    const timeLeftSec = timeLeftMs / 1000;
    const duration = durationSec;

    if (timeLeftSec <= 0) return 0;

    const remainder = timeLeftSec % duration;
    let correctCurrentTime = duration - remainder;

    // Edge case from original code
    if (correctCurrentTime >= duration) {
        correctCurrentTime = 0;
    }

    return correctCurrentTime;
}

function runTest(capability, timeLeftMs, durationSec, expectedTime) {
    const result = calculateExpectedTime(timeLeftMs, durationSec);
    const pass = Math.abs(result - expectedTime) < 0.001;
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${capability}`);
    if (!pass) {
        console.log(`  Expected: ${expectedTime}, Got: ${result}`);
        console.log(`  Inputs: timeLeft=${timeLeftMs}ms, duration=${durationSec}s`);
    }
}

console.log("Running Audio Sync Math Tests...");

// Test 1: Simple case
// Duration 60s, TimeLeft 10s.
// Should be at 50s. (Plays 10s -> ends at 60s. Timer ends at 0).
runTest("Simple alignment", 10000, 60, 50);

// Test 2: Wrapping case
// Duration 60s, TimeLeft 70s.
// Remainder = 10s.
// Should be at 50s. (Plays 10s -> ends at 60s. Timer at 60s. Loops).
runTest("Wrapping alignment", 70000, 60, 50);

// Test 3: Exact match
// Duration 60s, TimeLeft 60s.
// Remainder = 0.
// correct = 60 - 0 = 60 -> 0.
runTest("Exact duration match", 60000, 60, 0);

// Test 4: Duration 125s, TimeLeft 200s
// 200 % 125 = 75.
// correct = 125 - 75 = 50.
// Check: Plays 75s (from 50 to 125).
// Timer: 200 - 75 = 125.
// 125 is end of loop. Correct.
runTest("Irregular duration", 200000, 125, 50);

// Test 5: Just processed
// Duration 60s, TimeLeft 59.9s
// Remainder 59.9
// correct = 60 - 59.9 = 0.1
runTest("Fractional time", 59900, 60, 0.1);

console.log("Tests complete.");
