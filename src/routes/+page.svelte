<script lang="ts">
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import { marked } from "marked";
    import DOMPurify from "dompurify";
    import { Volume2, VolumeX } from "lucide-svelte";
    import type { ExamState } from "$lib/types";

    let state: ExamState = $state({
        status: "timer",
        targetTime: null,
        examStartTime: null,
        markdown: "",
        theme: "dark",
        backgroundUrl: "",
        audioUrl: "",
    });

    let timeLeft = $state(0);
    let timeString = $state("--:--:--");
    let currentTimeString = $state("");
    let contentDiv: HTMLDivElement | undefined = $state();

    // Multimedia
    let audioEl: HTMLAudioElement | undefined = $state();
    let isMuted = $state(true); // Default to muted for policy compliance
    let showMuteControls = $state(false);

    // SSE connection
    let eventSource: EventSource;

    // View state
    let showCorrections = $state(false);

    onMount(() => {
        const interval = setInterval(() => {
            const now = Date.now();

            // Handle targetTime being a string or number safely
            let target = null;
            if (state.targetTime) {
                // If it comes from JSON/Input as string, convert it
                target =
                    typeof state.targetTime === "string"
                        ? new Date(state.targetTime).getTime()
                        : state.targetTime;
            }

            // Timer logic
            if (target) {
                const diff = target - now;
                timeLeft = Math.max(0, diff);
            } else {
                timeLeft = 0;
            }

            // Update View Switch Trigger
            showCorrections =
                state.status !== "timer" || (target !== null && timeLeft === 0);

            // Sync Audio
            if (audioEl && state.audioUrl) {
                // Autoplay in content mode if not muted and paused
                if (state.status === "content") {
                    if (!isMuted && audioEl.paused) {
                        audioEl.play().catch(() => {});
                    }
                } else if (target) {
                    // ... (audio logic continues)
                    const duration = audioEl.duration;
                    if (duration && !isNaN(duration) && !audioEl.paused) {
                        // Unified Sync Logic
                        const timeUntilEnd = (target - now) / 1000;

                        // Continuous sync formula:
                        // (duration - (timeUntilEnd % duration)) % duration
                        let correctCurrentTime =
                            (duration - (timeUntilEnd % duration)) % duration;

                        // Handle edge cases
                        if (Number.isNaN(correctCurrentTime))
                            correctCurrentTime = 0;
                        if (correctCurrentTime === duration)
                            correctCurrentTime = 0;

                        // Identify drift
                        const drift = Math.abs(
                            audioEl.currentTime - correctCurrentTime,
                        );

                        // Sync if drift > 0.5s.
                        if (drift > 0.5) {
                            try {
                                audioEl.currentTime = correctCurrentTime;
                            } catch (e) {
                                // ignore
                            }
                        }
                    }

                    // Ensure playback if not muted
                    if (!isMuted && audioEl.paused) {
                        audioEl.play().catch(() => {});
                    }
                }
            }

            // Format time left
            const hours = Math.floor(timeLeft / 3600000);
            const minutes = Math.floor((timeLeft % 3600000) / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            timeString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

            // Current Time
            const cv = new Date();
            currentTimeString = cv.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
        }, 1000);

        eventSource = new EventSource("/api/events");
        eventSource.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            // Detect transition from timer to content
            if (state.status === "timer" && data.status === "content") {
                // Stop and reset audio
                if (audioEl) {
                    audioEl.pause();
                    audioEl.currentTime = 0;
                    isMuted = true;
                    audioEl.muted = true;
                }
            }

            state = data;

            // Apply Theme
            if (state.theme === "light") {
                document.documentElement.classList.add("light-theme");
            } else {
                document.documentElement.classList.remove("light-theme");
            }

            await renderContent();
        };

        return () => {
            if (eventSource) eventSource.close();
            clearInterval(interval);
        };
    });

    function pad(n: number) {
        return n < 10 ? "0" + n : n;
    }

    function toggleMute() {
        if (!audioEl) return;
        isMuted = !isMuted;
        audioEl.muted = isMuted;
        if (!isMuted) {
            // Try to play immediately if we are in the window
            audioEl.play().catch((e) => console.error("Play failed", e));
        }
    }

    // Derived state for view switching
    let isCorrectionsMode = $derived(
        state.status !== "timer" ||
            (state.targetTime !== null && timeLeft === 0),
    );

    async function renderContent() {
        if (state.markdown && contentDiv) {
            // Dynamic import for client-side only
            const { default: renderMathInElement } = await import(
                "katex/dist/contrib/auto-render.mjs"
            );

            const rawHtml = await marked.parse(state.markdown);
            const sanitized = DOMPurify.sanitize(rawHtml as string);
            contentDiv.innerHTML = sanitized;

            renderMathInElement(contentDiv, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                ],
                throwOnError: false,
            });
        }
    }

    // Reactively render
    $effect(() => {
        if (contentDiv && state.markdown) {
            renderContent();
        }
    });
</script>

<!-- Background Layer -->
{#if state.backgroundUrl}
    <!-- Hide media in Light Mode Corrections View -->
    {#if state.theme !== "light" || !showCorrections}
        {#if state.backgroundUrl.endsWith(".mp4")}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
                class="bg-media"
                src={state.backgroundUrl}
                autoplay
                loop
                muted
                playsinline
            ></video>
        {:else}
            <div
                class="bg-media"
                style="background-image: url('{state.backgroundUrl}')"
            ></div>
        {/if}
    {/if}
{/if}

<!-- Audio Layer -->
{#if state.audioUrl}
    <audio
        bind:this={audioEl}
        src={state.audioUrl}
        preload="auto"
        muted={isMuted}
        loop
    ></audio>

    <button class="mute-toggle" onclick={toggleMute}>
        {#if isMuted}
            <VolumeX size={24} />
        {:else}
            <Volume2 size={24} />
        {/if}
    </button>
{/if}

<div class="page-container">
    {#if !showCorrections}
        <div class="timer-view" in:fade={{ duration: 300 }}>
            {#if state.courseName}
                <div
                    class="course-name"
                    style={state.theme === "light"
                        ? "color: var(--scl-gray) !important;"
                        : ""}
                >
                    {state.courseName}
                </div>
            {/if}
            {#if state.examTitle}
                <div class="exam-title">{state.examTitle}</div>
            {/if}
            <div class="timer-label">Exam Starts In</div>
            <h1 class="timer-display">{timeString}</h1>
            <div class="server-time">Current Time: {currentTimeString}</div>
        </div>
    {:else}
        <!-- Corrections View -->
        <div class="exam-view" in:fade={{ duration: 300 }}>
            <header class="top-bar">
                <div class="clock-display">
                    {#if state.courseName || state.examTitle}
                        <div class="header-title-group">
                            {state.courseName}{state.courseName &&
                            state.examTitle
                                ? " - "
                                : ""}{state.examTitle}
                        </div>
                    {/if}
                    <div class="time-now">{currentTimeString}</div>
                </div>
            </header>
            <main class="content-view" bind:this={contentDiv}>
                <!-- Markdown content injected here -->
            </main>
        </div>
    {/if}
</div>

<style>
    .page-container {
        position: relative;
        z-index: 10;
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100%; /* Changed from 100vw to prevent scrollbar overflow issues */
        overflow: hidden;
    }

    .bg-media {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 0;
        background-size: cover;
        background-position: center;
        opacity: 0.3; /* Subtle background */
    }

    .mute-toggle {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 100;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        width: 48px;
        height: 48px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        transition: background 0.2s;
    }

    .mute-toggle:hover {
        background: rgba(0, 0, 0, 0.8);
    }

    /* Timer View */
    .timer-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        /* Remove explicit background to show media */
        background: transparent;
    }

    .timer-label {
        font-size: 1.5rem;
        color: var(--text-color);
        opacity: 0.7;
        margin-bottom: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
    }

    .timer-display {
        font-size: 8rem;
        font-weight: 800;
        margin: 0;
        font-variant-numeric: tabular-nums;
        color: var(--accent-color);
        text-shadow: 0 0 30px rgba(88, 166, 255, 0.2);
    }

    .server-time {
        margin-top: 2rem;
        font-size: 1.2rem;
        opacity: 0.5;
    }

    .course-name {
        font-size: 6rem;
        font-weight: 800;
        text-transform: uppercase;
        margin-bottom: 0.5rem;
        text-align: center;
        color: var(--text-color);
        letter-spacing: 0.05em;
    }

    .exam-title {
        font-size: 2rem;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: 3rem;
        opacity: 0.8;
        text-align: center;
        color: var(
            --text-color
        ); /* Will use SCL_GRAY (#1E2328) in light mode via root variable */
        letter-spacing: 0.05em;
    }

    /* Exam View */
    .exam-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--scl-white); /* SCL_WHITE Background */
        color: var(--scl-gray); /* SCL_GRAY Text */
        position: relative;
        z-index: 20;
    }

    .top-bar {
        padding: 1rem 2rem;
        background-color: var(--scl-blue); /* SCL_BLUE Header */
        display: flex;
        justify-content: flex-end; /* Align to right like Version 1 */
        align-items: center;
        border-bottom: none;
    }

    .clock-display {
        font-size: 1.5rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--scl-white);
        display: flex;
        align-items: center;
        gap: 1.5rem; /* Space between Title and Time */
    }

    .header-title-group {
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--scl-gold); /* SCL_GOLD Title */
        text-align: right;
    }

    .content-view {
        flex: 1;
        padding: 4rem 5%;
        overflow-y: auto;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
        font-size: 200%;
        background-color: var(--scl-white);
        color: var(--scl-gray);
    }

    /* Markdown Styles essentially handled by global, but ensuring readability */
    :global(.content-view h1) {
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 0.5rem;
        color: var(--scl-gray);
    }
    :global(.content-view p) {
        line-height: 1.6;
        margin-bottom: 1rem;
        color: var(--scl-gray);
    }

    @media (min-width: 1024px), (min-aspect-ratio: 16/9) {
        .content-view {
            column-count: 2;
            column-gap: 6rem;
            column-rule: 1px solid var(--border-color);
        }
    }
</style>
