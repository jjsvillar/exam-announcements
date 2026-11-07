import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/** @typedef {import('playwright-core').Page} Page */

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:5189';
const output = new URL('../../exam-announcements-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
// Only the disposable copy can receive API writes; source data is never opened.
const isolatedRoot = await mkdtemp(join(dirname(root), 'exam-fit-isolated-'));
/** @type {import('node:child_process').ChildProcess | undefined} */
let server;
let serverLog = '';
let browser;

async function ready() {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server && server.exitCode !== null) throw new Error(`Server exited: ${serverLog}`);
        if (!serverLog.includes('127.0.0.1:5189')) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
        }
        try {
            const response = await fetch(base);
            if (response.ok) return;
        } catch { /* server still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
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

/** @param {Page} page @param {string} selector */
async function measure(page, selector) {
    return page.locator(selector).evaluate((el) => {
        const panel = el.closest('section');
        const box = el.getBoundingClientRect();
        const panelBox = panel?.getBoundingClientRect();
        if (!panelBox) throw new Error('Missing instruction panel');
        return {
            font: parseFloat(getComputedStyle(el).fontSize),
            height: el.clientHeight, scrollHeight: el.scrollHeight,
            width: el.clientWidth, scrollWidth: el.scrollWidth,
            boxBottom: box.bottom, panelBottom: panelBox.bottom,
            panelHeight: panelBox.height,
            viewportHeight: innerHeight,
            overflow: getComputedStyle(el).overflowY,
            first: el.textContent.trim()
        };
    });
}

/** @param {Page} page @param {string} selector @param {string} text */
async function settled(page, selector, text) {
    await page.waitForFunction(({ selector, text }) => {
        const element = document.querySelector(selector);
        return element?.textContent?.includes(text);
    }, { selector, text });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    return measure(page, selector);
}

/** @param {Awaited<ReturnType<typeof measure>>} value @param {string} label */
function fits(value, label) {
    assert.ok(value.scrollHeight <= value.height + 2, `${label}: vertically clipped ${JSON.stringify(value)}`);
    assert.ok(value.scrollWidth <= value.width + 2, `${label}: horizontally clipped ${JSON.stringify(value)}`);
    assert.ok(value.boxBottom <= value.viewportHeight + 2, `${label}: below viewport ${JSON.stringify(value)}`);
}

try {
    for (const name of ['src', 'static', 'node_modules', 'package.json', 'svelte.config.js', 'tsconfig.json', 'vite.config.ts']) {
        await cp(join(root, name), join(isolatedRoot, name), { recursive: true });
    }
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], {
        cwd: isolatedRoot,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [server.stdout, server.stderr]) stream?.on('data', (data) => { serverLog += data; });
    await ready();
    console.log(execFileSync(process.execPath, [fileURLToPath(new URL('./sse_sync_verify.js', import.meta.url))], {
        env: { ...process.env, EXAM_APP_URL: base }, encoding: 'utf8'
    }).trim());
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    const long = Array.from({ length: 13 }, (_, i) => `- **Detailed instruction ${i + 1}**: Work carefully.`).join('\n');
    const mobileLong = Array.from({ length: 7 }, (_, i) => `- **Mobile instruction ${i + 1}**: Work carefully.`).join('\n');
    const short = '## Short instruction\n\nSolve $x^2 + y^2 = 1$.';
    await update({ examStartTime: Date.now() - 60_000, examEndTime: Date.now() + 3_600_000,
        backgroundUrl: '', audioUrl: '', clarifications: 'Clarification typography reference', generalInstructions: long });
    await page.goto(base);
    const general = '.content-column:first-child .content-view';
    let longGeneral = await settled(page, general, 'Detailed instruction 13');
    fits(longGeneral, 'desktop long general');
    assert.ok(longGeneral.font < 32 && longGeneral.font >= 16);
    const clarificationFont = await page.locator('.clarification-slide').evaluate(el => getComputedStyle(el).fontSize);
    async function assertTimesEqual() {
        const fonts = await page.locator('.header-time > span:last-child').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).fontSize));
        assert.equal(fonts.length, 2, 'both numeric time values displayed');
        assert.equal(fonts[0], fonts[1], 'numeric remaining and current time fonts match');
    }
    await assertTimesEqual();
    /** @type {Array<[number, string]>} */
    const urgencyCases = [[120, 'normal'], [50, 'yellow'], [20, 'orange'], [3, 'red']];
    for (const [minutes, urgency] of urgencyCases) {
        await update({ examEndTime: Date.now() + minutes * 60_000 });
        await page.waitForFunction(urgency => {
            const time = document.querySelector('.header-time-remaining');
            return urgency === 'normal' ? time && !/remaining-(yellow|orange|red)/.test(time.className) : time?.classList.contains(`remaining-${urgency}`);
        }, urgency);
        await assertTimesEqual();
    }
    await page.screenshot({ path: new URL('general-long-desktop.png', output).pathname });
    await update({ generalInstructions: short });
    let shortGeneral = await settled(page, general, 'Solve');
    fits(shortGeneral, 'desktop short general');
    assert.equal(shortGeneral.font, 32, 'short general returns to desktop default');
    assert.equal(await page.locator('.clarification-slide').evaluate(el => getComputedStyle(el).fontSize), clarificationFont);
    assert.ok(await page.locator(`${general} .katex`).count(), 'math rendered');
    assert.ok(await page.locator(`${general} h2`).count(), 'markdown heading rendered');
    await page.screenshot({ path: new URL('general-short-desktop.png', output).pathname });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="250"><rect width="1000" height="250" fill="green"/></svg>').toString('base64');
    await update({ generalInstructions: `Image sizing sample\n\n![diagram](data:image/svg+xml;base64,${svg})` });
    await settled(page, general, 'Image sizing sample');
    const image = page.locator(`${general} img`);
    await image.evaluate(img => { if (!(img instanceof HTMLImageElement)) throw new Error('Expected image'); return img.decode(); });
    assert.equal(await image.evaluate(img => img instanceof HTMLImageElement ? img.naturalWidth : 0), 1000);
    fits(await measure(page, general), 'loaded image general');
    await update({ generalInstructions: short });
    await settled(page, general, 'Solve');
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(400);
    let mobile = await measure(page, general);
    fits(mobile, 'mobile short general');
    assert.equal(mobile.font, 20, 'mobile default');
    await assertTimesEqual();
    const clarification = Array.from({ length: 3 }, (_, i) =>
        `Clarification paragraph ${i + 1}: Carefully review each part of the question and show all intermediate steps before submitting your final answer.`
    ).join('\n\n');
    await update({ clarifications: clarification });
    await settled(page, '.clarification-slide', 'Clarification paragraph 3');
    await page.locator('.clarification-slide').scrollIntoViewIfNeeded();
    const slide = await page.locator('.clarification-slide').evaluate((el) => {
        el.scrollTop = 0;
        const first = el.querySelector('p:first-child');
        if (!first) throw new Error('Missing first clarification paragraph');
        const firstTop = first.getBoundingClientRect().top;
        el.scrollTop = el.scrollHeight;
        const last = el.querySelector('p:last-child');
        if (!last) throw new Error('Missing final clarification paragraph');
        const bounds = el.getBoundingClientRect();
        return {
            font: getComputedStyle(el).fontSize,
            overflow: getComputedStyle(el).overflowY,
            firstTop,
            visibleTop: bounds.top,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            lastBottom: last.getBoundingClientRect().bottom,
            visibleBottom: bounds.bottom
        };
    });
    assert.equal(slide.font, '20px', 'clarification typography unchanged on mobile');
    assert.ok(slide.firstTop >= slide.visibleTop - 2,
        `first clarification must be visible at scroll start: ${JSON.stringify(slide)}`);
    assert.ok(slide.scrollHeight <= slide.clientHeight + 2 || slide.overflow === 'auto',
        `overflowing clarification must be user-scrollable: ${JSON.stringify(slide)}`);
    assert.ok(slide.scrollHeight <= slide.clientHeight + 2 || slide.scrollTop > 0,
        `scrolling must reach the last clarification: ${JSON.stringify(slide)}`);
    assert.ok(slide.lastBottom <= slide.visibleBottom + 2,
        `final clarification must be visible or reachable by scrolling: ${JSON.stringify(slide)}`);
    await page.screenshot({ path: new URL('clarification-multiparagraph-mobile.png', output).pathname });
    await update({ generalInstructions: mobileLong });
    mobile = await settled(page, general, 'Mobile instruction 7');
    fits(mobile, 'mobile long general');
    assert.ok(mobile.font < 20 && mobile.font >= 16);
    await page.screenshot({ path: new URL('general-long-mobile.png', output).pathname });
    await update({ generalInstructions: Array.from({ length: 120 }, (_, i) => `- Extreme general instruction ${i}`).join('\n') });
    const extremeGeneral = await settled(page, general, 'Extreme general instruction 119');
    assert.ok(extremeGeneral.font >= 16 && extremeGeneral.scrollHeight > extremeGeneral.height && extremeGeneral.overflow === 'auto', 'general readability-floor scroll fallback');
    await page.setViewportSize({ width: 1280, height: 800 });
    await update({ examStartTime: Date.now() + 3_600_000, preExamInstructions: short, generalInstructions: '' });
    const pre = '.preexam-instructions-content';
    let shortPre = await settled(page, pre, 'Solve');
    fits(shortPre, 'desktop short preexam');
    assert.ok(await page.locator(`${pre} .katex`).count());
    const fixedHeight = shortPre.panelHeight;
    await update({ preExamInstructions: long });
    let longPre = await settled(page, pre, 'Detailed instruction 13');
    fits(longPre, 'desktop long preexam');
    assert.ok(longPre.font < shortPre.font && longPre.font >= 16);
    assert.ok(Math.abs(longPre.panelHeight - fixedHeight) < 2, 'preexam panel geometry stable across SSE edits');
    await page.screenshot({ path: new URL('preexam-long-desktop.png', output).pathname });
    await page.setViewportSize({ width: 390, height: 700 });
    await update({ preExamInstructions: mobileLong });
    await page.waitForTimeout(400);
    await page.locator(pre).scrollIntoViewIfNeeded();
    let mobilePre = await settled(page, pre, 'Mobile instruction 7');
    fits(mobilePre, 'mobile long preexam');
    const mobileHeight = mobilePre.panelHeight;
    const longMobileFont = mobilePre.font;
    await update({ preExamInstructions: short });
    mobilePre = await settled(page, pre, 'Solve');
    fits(mobilePre, 'mobile short preexam');
    assert.ok(Math.abs(mobilePre.panelHeight - mobileHeight) < 2, 'mobile preexam panel geometry stable');
    assert.ok(mobilePre.font > longMobileFont, 'shorter preexam content regrows on mobile');
    await page.screenshot({ path: new URL('preexam-short-mobile.png', output).pathname });
    // Unavoidably overfull instructions retain readable text and a scrollable area.
    await update({ preExamInstructions: Array.from({ length: 120 }, (_, i) => `- Extreme instruction ${i}`).join('\n') });
    const extreme = await settled(page, pre, 'Extreme instruction 119');
    assert.ok(extreme.font >= 16 && extreme.scrollHeight > extreme.height && extreme.overflow === 'auto', 'readability-floor scroll fallback');
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log(JSON.stringify({ longGeneral, shortGeneral, mobileGeneral: mobile, shortPre, longPre, mobilePre }, null, 2));
    console.log('PASS: General/pre-exam fit, SSE updates, markdown/math, desktop/mobile, scroll fallback and sibling typography.');
} finally {
    await browser?.close();
    if (server) {
        server.kill('SIGTERM');
        await new Promise(resolve => { if (server?.exitCode !== null) resolve(undefined); else server.once('exit', resolve); });
    }
    await rm(isolatedRoot, { recursive: true, force: true });
}
