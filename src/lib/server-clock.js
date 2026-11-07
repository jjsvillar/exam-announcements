/**
 * @param {() => Promise<{ timestamp: number, timeZone: string }>} fetchTime
 * @param {() => number} monotonicNow
 */
export function createServerClock(fetchTime, monotonicNow = () => performance.now()) {
    /** @type {{ timestamp: number, monotonic: number } | null} */
    let anchor = null;
    /** @type {string | null} */
    let timeZone = null;
    /** @type {Promise<void> | null} */
    let pending = null;

    return {
        get timeZone() { return timeZone; },
        now() { return anchor === null ? null : anchor.timestamp + monotonicNow() - anchor.monotonic; },
        sync() {
            if (pending) return pending;
            const sent = monotonicNow();
            pending = (async () => {
                const sample = await fetchTime();
                const received = monotonicNow();
                if (!Number.isFinite(sample.timestamp) || typeof sample.timeZone !== 'string') {
                    throw new Error('Invalid host time response');
                }
                // Reject an unusable timezone rather than silently showing the viewer's local time.
                new Intl.DateTimeFormat('en-US', { timeZone: sample.timeZone });
                anchor = { timestamp: sample.timestamp, monotonic: (sent + received) / 2 };
                timeZone = sample.timeZone;
            })().finally(() => { pending = null; });
            return pending;
        }
    };
}
