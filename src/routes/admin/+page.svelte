<script lang="ts">
    import { onMount } from "svelte";
    import type { ExamState } from "$lib/types";

    let state: ExamState = $state({
        targetTime: null,
        examStartTime: null,
        markdown: "",
        courseName: "",
        examTitle: "",
    });

    let targetDate = $state(""); // YYYY-MM-DDTHH:mm

    onMount(() => {
        // Fetch current state via SSE (just once)
        const es = new EventSource("/api/events");
        es.onmessage = (event) => {
            const data = JSON.parse(event.data);
            state = data;

            if (state.targetTime) {
                // Formatting for datetime-local
                const d = new Date(state.targetTime);
                // Adjust to local ISO string
                // Create a date object that represents the same local time in UTC to get ISO string correctly formatted
                const localDate = new Date(
                    d.getTime() - d.getTimezoneOffset() * 60000,
                );
                targetDate = localDate.toISOString().slice(0, 16);
            }
            es.close();
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
                state[targetField] = data.url;
            } else {
                alert("Upload failed: " + data.error);
            }
        } catch (e) {
            alert("Upload error: " + e);
        }
    }

    async function save() {
        if (targetDate) {
            state.targetTime = new Date(targetDate).getTime();
        } else {
            state.targetTime = null;
        }

        try {
            const res = await fetch("/api/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(state),
            });
            if (res.ok) {
                // Flash success or similar
            } else {
                alert("Error saving.");
            }
        } catch (e) {
            alert("Error saving: " + e);
        }
    }

    function refreshSync() {
        // Just saving triggers the state update which client listens to.
        // The client logic should handle re-syncing on update.
        // We can explicitly clear and re-set to force it if needed, but save should work.
        save().then(() => alert("Saved & Synced!"));
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
                bind:value={state.courseName}
                placeholder="e.g. CS 136"
            />
        </div>

        <div class="control-group">
            <label for="examTitle">Exam Title</label>
            <input
                type="text"
                id="examTitle"
                bind:value={state.examTitle}
                placeholder="e.g. Long Exam 1"
            />
        </div>

        <div class="control-group">
            <label for="status">Status</label>
            <select id="status" bind:value={state.status}>
                <option value="timer">Timer View (Countdown)</option>
                <option value="content">Exam Content View</option>
            </select>
        </div>

        <div class="control-group">
            <label for="targetTime">Target Time (Countdown End)</label>
            <input
                type="datetime-local"
                id="targetTime"
                bind:value={targetDate}
            />
        </div>

        <div class="control-group">
            <label for="theme">Theme</label>
            <select id="theme" bind:value={state.theme}>
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
                    bind:value={state.backgroundUrl}
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
                    bind:value={state.audioUrl}
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

        <div class="editor-group">
            <label for="markdown">Markdown Content (Supports LaTeX)</label>
            <textarea
                id="markdown"
                bind:value={state.markdown}
                rows="15"
                placeholder="# Exam Instructions..."
            ></textarea>
            <div class="help-text">
                Use $...$ for inline math and $$...$$ for block math.
            </div>
        </div>

        <div class="button-row">
            <button
                onclick={() => save().then(() => alert("Saved!"))}
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
