// @ts-nocheck Browser instrumentation adds temporary globals to the isolated page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:5192';
const dataFile = join(root, 'data/exam_state.json');
const hash = async () => createHash('sha256').update(await readFile(dataFile)).digest('hex');
const before = await hash();
const isolated = await mkdtemp(join(dirname(root), 'exam-ding-isolated-'));
let server;
let browser;
let serverLog = '';

async function update(patch) {
    const response = await fetch(`${base}/api/state`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    });
    assert.equal(response.status, 200);
}

try {
    for (const name of ['src', 'static', 'data', 'node_modules', 'package.json', 'svelte.config.js', 'tsconfig.json', 'vite.config.ts']) {
        await cp(join(root, name), join(isolated, name), { recursive: true });
    }
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], {
        cwd: isolated, stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [server.stdout, server.stderr]) stream?.on('data', data => { serverLog += data; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(serverLog);
        if (serverLog.includes('127.0.0.1:5192')) {
            try { ready = (await fetch(base)).ok; } catch { /* still starting */ }
        }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Server did not start: ${serverLog}`);
    await update({ examStartTime: Date.now() - 60_000, examEndTime: Date.now() + 3_600_000,
        generalInstructions: 'Initial', clarifications: 'Initial clarification', audioUrl: '' });

    browser = await chromium.launch({ headless: true,
        executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
        window.dingCalls = [];
        window.sseCount = 0;
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
            constructor(url, options) {
                super(url, options);
                this.addEventListener('message', () => { window.sseCount += 1; });
            }
        };
        const nativeResume = AudioContext.prototype.resume;
        AudioContext.prototype.resume = function () {
            window.dingCalls.push({ action: 'resume' });
            return nativeResume.call(this);
        };
        const nativeOscillator = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            const id = window.dingCalls.filter(call => call.action === 'oscillator').length;
            window.dingCalls.push({ action: 'oscillator', id });
            const oscillator = nativeOscillator.call(this);
            const nativeStart = oscillator.start;
            oscillator.start = function (time) {
                window.dingCalls.push({ action: 'start', id, time });
                return nativeStart.call(this, time);
            };
            const nativeStop = oscillator.stop;
            oscillator.stop = function (time) {
                window.dingCalls.push({ action: 'stop', id, time, audioNow: this.context.currentTime, wallNow: performance.now() });
                return nativeStop.call(this, time);
            };
            return oscillator;
        };
        const nativeGain = AudioContext.prototype.createGain;
        AudioContext.prototype.createGain = function () {
            const gain = nativeGain.call(this);
            const nativeRamp = gain.gain.exponentialRampToValueAtTime;
            gain.gain.exponentialRampToValueAtTime = function (value, time) {
                window.dingCalls.push({ action: 'gain', value, time });
                return nativeRamp.call(this, value, time);
            };
            return gain;
        };
    });
    const calls = () => page.evaluate(() => window.dingCalls);
    const starts = async () => (await calls()).filter(call => call.action === 'start').length;
    let received = 1;
    const send = async (patch) => {
        await update(patch);
        received += 1;
        await page.waitForFunction(count => window.sseCount >= count, received);
    };
    const button = page.getByRole('button', { name: 'Enable exam and update dings' });
    await page.goto(base);
    await page.getByText('Initial clarification').waitFor();
    assert.ok(await page.locator('.ding-toggle').isVisible(), 'control visible without a music URL');
    assert.equal(await starts(), 0, 'initial SSE snapshot is silent');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await button.click();
    await page.getByRole('button', { name: 'Mute exam and update dings' }).waitFor();
    assert.equal((await calls()).filter(call => call.action === 'resume').length, 1, 'resume from button gesture');
    assert.equal(await starts(), 0, 'enabling does not replay initial snapshot');

    const expectStarts = async (count, message) => {
        await page.waitForTimeout(120);
        assert.equal(await starts(), count, message);
    };
    await send({ theme: 'light', preExamInstructions: 'Not announced', audioUrl: '/music.mp3', examStartTime: Date.now() + 3_600_000 });
    assert.ok(await page.locator('.ding-toggle').isVisible(), 'ding control remains visible before exam');
    await expectStarts(0, 'unrelated fields are silent');
    await send({ generalInstructions: 'Changed instruction', clarifications: 'Changed clarification', examEndTime: Date.now() + 4_000_000 });
    await expectStarts(1, 'one snapshot changing three fields makes one ding');
    const sounds = await calls();
    const start = sounds.find(call => call.action === 'start');
    const stop = sounds.find(call => call.action === 'stop');
    assert.ok(start && stop && stop.time - start.time > 0.2 && stop.time - start.time < 0.3, 'short scheduled oscillator');
    assert.ok(sounds.some(call => call.action === 'gain' && call.value === 0.025), 'soft peak gain');
    await send({ examStartTime: Date.now() - 60_000 });
    await page.locator('.exam-view').waitFor();
    await page.getByText('Changed clarification').waitFor();
    await expectStarts(1, 'transition into exam is silent');
    await send({ generalInstructions: 'Changed instruction', clarifications: 'Changed clarification' });
    await expectStarts(1, 'duplicate snapshot is silent');
    await send({ generalInstructions: '', clarifications: '', examEndTime: null });
    await page.getByText('Changed clarification').waitFor({ state: 'hidden' });
    await expectStarts(2, 'clearing content and end time dings once');
    await page.getByRole('button', { name: 'Mute exam and update dings' }).click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await send({ generalInstructions: 'Muted change' });
    await page.getByText('Muted change').waitFor();
    await expectStarts(2, 'muted changes do not schedule sound');
    await button.click();
    await expectStarts(2, 'reenabling does not replay missed update');
    await send({ clarifications: 'After reenable' });
    await page.getByText('After reenable').waitFor();
    await expectStarts(3, 'subsequent update dings');
    assert.deepEqual(errors, [], 'no browser exceptions');

    const blocked = await browser.newPage();
    blocked.on('pageerror', error => errors.push(String(error)));
    await blocked.addInitScript(() => {
        const original = AudioContext.prototype.resume;
        AudioContext.prototype.resume = function () { return Promise.reject(new Error('Blocked')); };
    });
    await blocked.goto(base);
    await blocked.getByText('After reenable').waitFor();
    await blocked.getByRole('button', { name: 'Enable exam and update dings' }).click();
    assert.equal(await blocked.getByRole('button', { name: 'Enable exam and update dings' }).getAttribute('aria-pressed'), 'false');
    await update({ clarifications: 'Blocked change' });
    await blocked.getByText('Blocked change').waitFor();
    await page.getByText('Blocked change').waitFor();
    await expectStarts(4, 'blocked-page update still gives the enabled page one ding');
    assert.deepEqual(errors, [], 'blocked audio does not break SSE');
    await blocked.close();

    await send({ examEndTime: Date.now() + 4_500 });
    await expectStarts(5, 'changing end time schedules one update ding, not the expiry alarm');
    const mutedExpiry = await page.evaluate(async () => {
        await new Promise(resolve => {
            const watch = () => {
                if (window.dingCalls.filter(call => call.action === 'start').length === 8) resolve();
                else requestAnimationFrame(watch);
            };
            watch();
        });
        const before = window.dingCalls.slice();
        document.querySelector('.ding-toggle').click();
        return { before, after: window.dingCalls.slice() };
    });
    const expiryStarts = mutedExpiry.before.filter(call => call.action === 'start').slice(5);
    assert.equal(expiryStarts.length, 3, 'expiry schedules exactly three oscillators');
    assert.ok(Math.abs(expiryStarts[1].time - expiryStarts[0].time - 0.35) < 0.02, 'first gap is 350ms');
    assert.ok(Math.abs(expiryStarts[2].time - expiryStarts[1].time - 0.35) < 0.02, 'second gap is 350ms');
    const cancellation = mutedExpiry.after.slice(mutedExpiry.before.length).filter(call => call.action === 'stop');
    const pending = expiryStarts.slice(1);
    assert.ok(pending.every(start => start.time > cancellation[0]?.audioNow + 0.1), 'mute occurs before the pending dings start');
    assert.deepEqual(cancellation.map(call => call.id).sort(), expiryStarts.map(call => call.id).sort(), 'mute stops every active/scheduled expiry oscillator');
    assert.ok(cancellation.every(call => Math.abs(call.time - call.audioNow) < 0.05), 'pending stops are rescheduled immediately at mute');
    assert.ok(Math.max(...cancellation.map(call => call.wallNow)) - Math.min(...cancellation.map(call => call.wallNow)) < 50, 'all stops happen in the same mute action');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await page.waitForTimeout(1_200);
    assert.equal(await starts(), 8, 'zero remains silent and mute does not schedule replacements');

    await button.click();
    await expectStarts(8, 'reenabling does not replay cancelled dings');

    await send({ examEndTime: Date.now() + 3_500 });
    await expectStarts(9, 'rearming produces only the usual single update ding');
    await page.waitForFunction(() => window.dingCalls.filter(call => call.action === 'start').length === 12, null, { timeout: 6_000 });
    assert.equal(await starts(), 12, 'second genuine expiry schedules three more dings');

    await page.getByRole('button', { name: 'Mute exam and update dings' }).click();
    await send({ examEndTime: Date.now() + 3_500 });
    await page.waitForFunction(() => document.querySelector('.header-time-remaining > span:last-child')?.textContent === '00:00:00', null, { timeout: 6_000 });
    await page.waitForTimeout(1_100);
    assert.equal(await starts(), 12, 'muted update and expiry stay silent');

    await update({ examEndTime: Date.now() - 5_000 });
    const alreadyExpired = await browser.newPage();
    await alreadyExpired.addInitScript(() => {
        window.expiryStarts = 0;
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            window.expiryStarts++;
            return original.call(this);
        };
    });
    alreadyExpired.on('pageerror', error => errors.push(String(error)));
    await alreadyExpired.goto(base);
    await alreadyExpired.locator('.header-time-remaining').waitFor();
    await alreadyExpired.getByRole('button', { name: 'Enable exam and update dings' }).click();
    await alreadyExpired.waitForTimeout(1_300);
    assert.equal(await alreadyExpired.evaluate(() => window.expiryStarts), 0, 'startup already-expired exam stays silent');
    await update({ examStartTime: Date.now() + 60_000, examEndTime: Date.now() + 2_500 });
    await alreadyExpired.locator('.timer-display').waitFor();
    await alreadyExpired.waitForTimeout(3_500);
    assert.equal(await alreadyExpired.evaluate(() => window.expiryStarts), 1, 'pre-exam end-time change dings once but expiry does not alarm');
    await alreadyExpired.close();
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('PASS: update dings single; expiry three at 350ms spacing, immediate mute cancellation, no replay, one-shot, rearmed, muted, initial-expired, and pre-exam paths verified.');
} finally {
    await browser?.close();
    if (server) {
        server.kill('SIGTERM');
        await new Promise(resolve => { if (server.exitCode !== null) resolve(undefined); else server.once('exit', resolve); });
    }
    await rm(isolated, { recursive: true, force: true });
    assert.equal(await hash(), before, 'source data unchanged');
}
