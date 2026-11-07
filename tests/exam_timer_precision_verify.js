import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const statePath = join(root, 'data/exam_state.json');
const hashSource = async () => {
    try { return createHash('sha256').update(await readFile(statePath)).digest('hex'); }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
    }
};
const originalHash = await hashSource();
const isolatedRoot = await mkdtemp(join(dirname(root), 'exam-timer-isolated-'));
const base = 'http://127.0.0.1:5197';
/** @type {import('node:child_process').ChildProcess | undefined} */
let server;
/** @type {import('playwright-core').Browser | undefined} */
let browser;
let serverLog = '';

async function ready() {
    for (let attempt = 0; attempt < 120; attempt++) {
        if (server && server.exitCode !== null) throw new Error(`Server exited: ${serverLog}`);
        try {
            const response = await fetch(base);
            if (response.ok && serverLog.includes('127.0.0.1:5197')) return;
        } catch { /* starting */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start: ${serverLog}`);
}

/** @param {Record<string, unknown>} patch */
async function update(patch) {
    const response = await fetch(`${base}/api/state`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    assert.equal(response.status, 200);
}

/** @param {import('playwright-core').Page} page @param {string} label */
async function fits(page, label) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    const measured = await page.evaluate(() => {
        const header = document.querySelector('.top-bar');
        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            headerRight: header?.getBoundingClientRect().right,
            values: [...document.querySelectorAll('.header-time > span:last-child')].map(el => {
                const box = el.getBoundingClientRect();
                return { left: box.left, right: box.right, font: getComputedStyle(el).fontSize };
            })
        };
    });
    assert.ok(measured.documentWidth <= measured.viewportWidth + 2, `${label} page overflow: ${JSON.stringify(measured)}`);
    assert.equal(measured.values.length, 2, `${label} two time values`);
    assert.equal(measured.values[0].font, measured.values[1].font, `${label} time value fonts match`);
    for (const value of measured.values) {
        assert.ok(value.left >= -2 && value.right <= measured.viewportWidth + 2, `${label} time outside viewport: ${JSON.stringify(measured)}`);
    }
}

try {
    for (const name of ['src', 'static', 'node_modules', 'package.json', 'svelte.config.js', 'tsconfig.json', 'vite.config.ts']) {
        await cp(join(root, name), join(isolatedRoot, name), { recursive: true });
    }
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], {
        cwd: isolatedRoot, stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [server.stdout, server.stderr]) stream?.on('data', data => { serverLog += data; });
    await ready();
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
        const schedule = window.setInterval.bind(window);
        const cancel = window.clearInterval.bind(window);
        const activeHundredMs = new Set();
        const activeSeconds = new Set();
        /** @param {TimerHandler} handler @param {number} [delay] @param {any[]} args */
        const trackedInterval = (handler, delay, ...args) => {
            const id = schedule(handler, delay, ...args);
            if (delay === 100) activeHundredMs.add(id);
            if (delay === 1000) activeSeconds.add(id);
            return id;
        };
        Object.defineProperty(window, 'setInterval', { value: trackedInterval });
        window.clearInterval = id => { activeHundredMs.delete(id); activeSeconds.delete(id); cancel(id); };
        Object.defineProperty(window, '__activeHundredMs', { value: activeHundredMs });
        Object.defineProperty(window, '__activeSeconds', { value: activeSeconds });
    });
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const remaining = page.locator('.header-time-remaining > span:last-child');
    const color = page.locator('.header-time-remaining');

    await update({ examStartTime: Date.now() - 60_000, examEndTime: Date.now() + 11 * 60_000 + 10_000,
        courseName: 'CS 101', examTitle: 'Precision examination', generalInstructions: 'Read carefully.',
        clarifications: 'First clarification\n---\nSecond clarification', audioUrl: '', backgroundUrl: '' });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('.header-time-remaining > span:last-child')?.textContent === '00:12:00');
    assert.ok(await color.evaluate(el => el.classList.contains('remaining-orange')), '11-minute range remains orange');
    await fits(page, 'desktop minute range');
    console.log('Desktop >10m: minute precision, orange color, no overflow');

    await update({ examEndTime: Date.now() + 10 * 60_000 + 350 });
    await page.waitForFunction(() => /00:09:59$/.test(document.querySelector('.header-time-remaining > span:last-child')?.textContent ?? ''), null, { timeout: 2500 });
    assert.ok(await color.evaluate(el => el.classList.contains('remaining-orange')), 'ten-minute range remains orange');
    const secondsBefore = await remaining.textContent();
    await page.waitForFunction(before => document.querySelector('.header-time-remaining > span:last-child')?.textContent !== before,
        secondsBefore, { timeout: 1400 });
    const secondsAfter = await remaining.textContent();
    assert.match(secondsAfter ?? '', /^00:09:\d{2}$/);
    console.log(`At 10m crossing: ${secondsBefore} -> ${secondsAfter}, second precision and orange color`);

    await update({ examEndTime: Date.now() + 5 * 60_000 + 350 });
    await page.waitForFunction(() => /^00:04:\d{2}$/.test(document.querySelector('.header-time-remaining > span:last-child')?.textContent ?? ''), null, { timeout: 2500 });
    assert.ok(await color.evaluate(el => el.classList.contains('remaining-red')), 'five-minute range red');
    const firstSecond = await remaining.textContent();
    await page.waitForFunction(before => document.querySelector('.header-time-remaining > span:last-child')?.textContent !== before,
        firstSecond, { timeout: 1500 });
    const secondsNearEnd = await remaining.textContent();
    await page.waitForTimeout(180);
    assert.equal(await remaining.textContent(), secondsNearEnd, 'subsecond updates never change whole-second display');
    await page.waitForFunction(before => document.querySelector('.header-time-remaining > span:last-child')?.textContent !== before,
        secondsNearEnd, { timeout: 1500 });
    const nextSecond = await remaining.textContent();
    assert.match(nextSecond ?? '', /^00:04:\d{2}$/);
    console.log(`At 5m crossing: ${secondsNearEnd} -> ${nextSecond}, whole-second precision and red color`);
    await fits(page, 'desktop seconds');
    await page.setViewportSize({ width: 390, height: 700 });
    await fits(page, 'mobile seconds');
    console.log('Desktop/mobile seconds: numeric values fit and page has no horizontal overflow');

    const first = await page.locator('.clarification-slide').textContent();
    assert.match(first ?? '', /First clarification/);
    await page.waitForTimeout(1_500);
    assert.match(await page.locator('.clarification-slide').textContent() ?? '', /First clarification/, 'clarifications do not rotate before ten seconds');
    await page.waitForFunction(() => document.querySelector('.clarification-slide')?.textContent?.includes('Second clarification'), null, { timeout: 12_000 });
    console.log('Clarifications rotate after ten one-second ticks');

    await update({ examEndTime: Date.now() - 1_000 });
    await page.waitForFunction(() => document.querySelector('.header-time-remaining > span:last-child')?.textContent === '00:00:00');
    assert.ok(await color.evaluate(el => el.classList.contains('remaining-red')), 'expired timer remains red');
    assert.equal(await page.evaluate(() => Reflect.get(window, '__activeHundredMs').size), 0, 'no 100ms display timer');
    assert.equal(await page.evaluate(() => Reflect.get(window, '__activeSeconds').size), 1, 'one second cadence while mounted');

    await update({ examStartTime: Date.now() + 4 * 60_000 + 37_000, examEndTime: Date.now() + 60 * 60_000 });
    await page.waitForFunction(() => document.querySelector('.timer-display')?.textContent?.match(/^00:04:3[0-7]$/));
    assert.match(await page.locator('.server-time').textContent() ?? '', /Current Time: \d{2}:\d{2} [AP]M/);
    assert.equal(await page.locator('.header-time-remaining').count(), 0, 'exam timer absent pre-exam');
    assert.equal(await page.evaluate(() => Reflect.get(window, '__activeHundredMs').size), 0, 'no high-frequency timer while page mounted');
    const probe = await page.evaluate(() => {
        const token = crypto.randomUUID();
        Object.defineProperty(window, '__timerProbe', { value: token });
        const link = document.createElement('a');
        link.href = '/admin';
        link.textContent = 'Timer teardown check';
        document.body.append(link);
        link.click();
        return token;
    });
    await page.waitForURL('**/admin');
    assert.equal(await page.evaluate(token => Reflect.get(window, '__timerProbe') === token, probe), true, 'client navigation retains the same document');
    assert.equal(await page.evaluate(() => Reflect.get(window, '__activeSeconds').size), 0, 'one-second display interval cleared on unmount');
    assert.equal(await page.evaluate(() => Reflect.get(window, '__activeHundredMs').size), 0, 'no 100ms timer after unmount');
    assert.deepEqual(errors, [], 'no browser page errors');
    console.log('Pre-exam countdown/current clock unchanged; one-second interval removed on client navigation; no browser errors');
} finally {
    if (browser) await browser.close();
    if (server) {
        server.kill();
        const ownedServer = server;
        await new Promise(resolve => ownedServer.once('exit', resolve));
    }
    await rm(isolatedRoot, { recursive: true, force: true });
    assert.equal(await hashSource(), originalHash, 'original source exam state remains byte-identical');
    console.log('Original source exam data SHA-256 unchanged');
}
