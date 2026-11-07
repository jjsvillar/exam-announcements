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
            window.dingCalls.push({ action: 'oscillator' });
            const oscillator = nativeOscillator.call(this);
            const nativeStart = oscillator.start;
            oscillator.start = function (time) {
                window.dingCalls.push({ action: 'start', time });
                return nativeStart.call(this, time);
            };
            const nativeStop = oscillator.stop;
            oscillator.stop = function (time) {
                window.dingCalls.push({ action: 'stop', time });
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
    const button = page.getByRole('button', { name: 'Enable update ding' });
    await page.goto(base);
    await page.getByText('Initial clarification').waitFor();
    assert.ok(await page.locator('.ding-toggle').isVisible(), 'control visible without a music URL');
    assert.equal(await starts(), 0, 'initial SSE snapshot is silent');
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await button.click();
    await page.getByRole('button', { name: 'Mute update ding' }).waitFor();
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
    await page.getByRole('button', { name: 'Mute update ding' }).click();
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
    await blocked.getByRole('button', { name: 'Enable update ding' }).click();
    assert.equal(await blocked.getByRole('button', { name: 'Enable update ding' }).getAttribute('aria-pressed'), 'false');
    await update({ clarifications: 'Blocked change' });
    await blocked.getByText('Blocked change').waitFor();
    assert.deepEqual(errors, [], 'blocked audio does not break SSE');
    await blocked.close();
    console.log('PASS: live SSE admin updates schedule one quiet short oscillator; initial, duplicate, unrelated, muted, blocked, and clearing states verified.');
} finally {
    await browser?.close();
    if (server) {
        server.kill('SIGTERM');
        await new Promise(resolve => { if (server.exitCode !== null) resolve(undefined); else server.once('exit', resolve); });
    }
    await rm(isolated, { recursive: true, force: true });
    assert.equal(await hash(), before, 'source data unchanged');
}
