const MINUTE = 60_000;

/** @param {number | null} milliseconds */
export function formatDuration(milliseconds) {
    if (milliseconds === null) return "--:--:--";

    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / MINUTE);
    const seconds = Math.floor((milliseconds % MINUTE) / 1000);
    return [hours, minutes, seconds]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
}

/** @param {number | null} milliseconds */
export function formatExamTimeRemaining(milliseconds) {
    if (milliseconds === null) return "--:--:--";

    const remaining = Math.max(0, milliseconds);
    if (remaining > 10 * MINUTE) return formatDuration(Math.ceil(remaining / MINUTE) * MINUTE);
    return formatDuration(remaining);
}

/** @param {number | null} milliseconds */
export function getExamTimeUrgency(milliseconds) {
    if (milliseconds === null) return "normal";
    if (milliseconds <= 5 * MINUTE) return "red";
    if (milliseconds <= 30 * MINUTE) return "orange";
    if (milliseconds <= 60 * MINUTE) return "yellow";
    return "normal";
}

/** @param {number | null} timestamp @param {string} [timeZone] */
export function formatCurrentTime(timestamp, timeZone) {
    if (timestamp === null) return "--:-- --";
    return new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        ...(timeZone ? { timeZone } : {}),
    });
}
