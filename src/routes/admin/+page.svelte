<script lang="ts">
    import { onMount } from "svelte";
    import type { ExamState } from "$lib/types";

    let examState: ExamState = $state({
        examStartTime: null,
        examEndTime: null,
        generalInstructions: "",
        clarifications: "",
        status: "timer",
        theme: "dark",
        backgroundUrl: "",
        audioUrl: "",
        courseName: "",
        examTitle: "",
    });

    let startDate = $state("");
    let endDate = $state("");

    function toLocalDateTime(timestamp: number | null) {
        if (timestamp === null) return "";

        const date = new Date(timestamp);
        const localDate = new Date(
            date.getTime() - date.getTimezoneOffset() * 60000,
        );
        return localDate.toISOString().slice(0, 16);
    }

    onMount(() => {
        // Keep the admin form synchronized with every pushed state update.
        const es = new EventSource("/api/events");
        es.onmessage = (event) => {
            const data = JSON.parse(event.data);
            examState = data;

            startDate = toLocalDateTime(examState.examStartTime);
            endDate = toLocalDateTime(examState.examEndTime);
        };

        return () => es.close();
    });

    async function uploadFile(
        event: Event,
        targetField: "backgroundUrl" | "audioUrl",
    ) {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            const data = await res.json();
            if (data.success) {
                examState[targetField] = data.url;
            } else {
                alert("Upload failed: " + data.error);
            }
        } catch (e) {
            alert("Upload error: " + e);
        }
    }

    async function save() {
        const startTime = startDate ? new Date(startDate).getTime() : null;
        const endTime = endDate ? new Date(endDate).getTime() : null;

        if (startTime !== null && endTime !== null && endTime <= startTime) {
            alert("Time end must be later than time start.");
            return false;
        }

        examState.examStartTime = startTime;
        examState.examEndTime = endTime;

        try {
            const res = await fetch("/api/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(examState),
            });
            if (res.ok) {
                return true;
            } else {
                alert("Error saving.");
            }
        } catch (e) {
            alert("Error saving: " + e);
        }

        return false;
    }

    function refreshSync() {
        // Just saving triggers the state update which client listens to.
        // The client logic should handle re-syncing on update.
        // We can explicitly clear and re-set to force it if needed, but save should work.
        save().then((saved) => {
            if (saved) alert("Saved & Synced!");
        });
    }
</script>

<div class="admin-container">
    <h1>Exam Timer Admin</h1>

    <div class="card">
        <div class="control-group">
            <label for="courseName">Course Name</label>
            <input
                type="text"
                id="courseName"
                bind:value={examState.courseName}
                placeholder="e.g. CS 136"
            />
        </div>

        <div class="control-group">
            <label for="examTitle">Exam Title</label>
            <input
                type="text"
                id="examTitle"
                bind:value={examState.examTitle}
                placeholder="e.g. Long Exam 1"
            />
        </div>

        <div class="control-group">
            <label for="status">Status</label>
            <select id="status" bind:value={examState.status}>
                <option value="timer">Timer View (Countdown)</option>
                <option value="content">Exam Content View</option>
            </select>
        </div>

        <div class="control-group">
            <label for="startTime">Time Start</label>
            <input
                type="datetime-local"
                id="startTime"
                bind:value={startDate}
            />
            <div class="help-text">Basis of the pre-exam countdown.</div>
        </div>

        <div class="control-group">
            <label for="endTime">Time End</label>
            <input
                type="datetime-local"
                id="endTime"
                bind:value={endDate}
            />
            <div class="help-text">
                Basis of the time remaining during the exam.
            </div>
        </div>

        <div class="control-group">
            <label for="theme">Theme</label>
            <select id="theme" bind:value={examState.theme}>
                <option value="dark">Dark Theme (Default)</option>
                <option value="light">Light Theme (Gold/Blue)</option>
            </select>
        </div>

        <div class="control-group">
            <label for="backgroundUrl">Background (MP4/GIF)</label>
            <div class="input-row">
                <input
                    type="text"
                    id="backgroundUrl"
                    bind:value={examState.backgroundUrl}
                    placeholder="https://example.com/loop.mp4"
                />
                <input
                    type="file"
                    accept="video/mp4,image/gif,image/jpeg,image/png"
                    onchange={(e) => uploadFile(e, "backgroundUrl")}
                    style="max-width: 200px;"
                />
            </div>
        </div>

        <div class="control-group">
            <label for="audioUrl">Audio (Ends at 0:00)</label>
            <div class="input-row">
                <input
                    type="text"
                    id="audioUrl"
                    bind:value={examState.audioUrl}
                    placeholder="https://example.com/music.mp3"
                />
                <input
                    type="file"
                    accept="audio/*"
                    onchange={(e) => uploadFile(e, "audioUrl")}
                    style="max-width: 200px;"
                />
            </div>
        </div>

        <div class="editor-grid">
            <div class="editor-group">
                <label for="generalInstructions">General Instructions</label>
                <textarea
                    id="generalInstructions"
                    bind:value={examState.generalInstructions}
                    rows="15"
                    placeholder="# General Instructions..."
                ></textarea>
            </div>

            <div class="editor-group">
                <label for="clarifications">Clarifications</label>
                <textarea
                    id="clarifications"
                    bind:value={examState.clarifications}
                    rows="15"
                    placeholder="# Clarifications..."
                ></textarea>
            </div>
        </div>
        <div class="help-text">
            Both fields support Markdown. Use $...$ for inline math and $$...$$
            for block math.
        </div>

        <div class="button-row">
            <button
                onclick={() =>
                    save().then((saved) => {
                        if (saved) alert("Saved!");
                    })}
                class="save-btn">Save</button
            >
            <button onclick={refreshSync} class="sync-btn"
                >Save & Refresh Sync</button
            >
        </div>
    </div>
</div>

<style>
    .admin-container {
        padding: 2rem;
        max-width: 900px;
        margin: 0 auto;
    }

    h1 {
        margin-bottom: 2rem;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 1rem;
    }

    .card {
        background: var(--secondary-bg);
        padding: 2rem;
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }

    .control-group {
        margin-bottom: 1.5rem;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: var(--text-color);
    }

    select,
    input[type="datetime-local"],
    input[type="text"] {
        padding: 0.5rem;
        background: #0d1117;
        border: 1px solid var(--border-color);
        color: white;
        border-radius: 6px;
        font-size: 1rem;
        width: 100%;
        max-width: 300px;
    }

    textarea {
        width: 100%;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo,
            monospace;
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid var(--border-color);
        padding: 1rem;
        border-radius: 6px;
        font-size: 0.9rem;
        resize: vertical;
        box-sizing: border-box;
    }

    .editor-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.5rem;
    }

    @media (max-width: 720px) {
        .editor-grid {
            grid-template-columns: 1fr;
        }
    }

    .help-text {
        font-size: 0.8rem;
        opacity: 0.6;
        margin-top: 0.5rem;
    }

    .save-btn {
        background: var(--accent-color);
        color: #0d1117;
        font-weight: 700;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        margin-top: 1rem;
        transition: opacity 0.2s;
    }

    .save-btn:hover {
        opacity: 0.9;
    }
</style>
