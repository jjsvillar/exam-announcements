<script lang="ts">
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import { marked } from "marked";
    import DOMPurify from "dompurify";
    import { Volume2, VolumeX } from "lucide-svelte";
    import type { ExamState } from "$lib/types";

    let examState: ExamState = $state({
        status: "timer",
        examStartTime: null,
        examEndTime: null,
        generalInstructions: "",
        clarifications: "",
        theme: "dark",
        backgroundUrl: "",
        audioUrl: "",
    });

    let now = $state(Date.now());
    let generalInstructionsDiv: HTMLDivElement | undefined = $state();
    let clarificationsDiv: HTMLDivElement | undefined = $state();

    // Multimedia
    let audioEl: HTMLAudioElement | undefined = $state();
    let isMuted = $state(true); // Default to muted for policy compliance
    // SSE connection
    let eventSource: EventSource;

    const startTimeLeft = $derived(
        examState.examStartTime === null
            ? null
            : Math.max(0, examState.examStartTime - now),
    );
    const endTimeLeft = $derived(
        examState.examEndTime === null
            ? null
            : Math.max(0, examState.examEndTime - now),
    );
    const showExam = $derived(
        examState.status !== "timer" ||
            (examState.examStartTime !== null && startTimeLeft === 0),
    );
    const startTimeString = $derived(formatDuration(startTimeLeft));
    const endTimeString = $derived(formatExamTimeRemaining(endTimeLeft));
    const endTimeUrgency = $derived(
        endTimeLeft === null
            ? "normal"
            : endTimeLeft <= 5 * 60_000
              ? "red"
              : endTimeLeft <= 15 * 60_000
                ? "orange"
                : endTimeLeft <= 30 * 60_000
                  ? "yellow"
                  : "normal",
    );
    const currentTimeString = $derived(
        new Date(now).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        }),
    );

    onMount(() => {
        const interval = setInterval(() => {
            now = Date.now();

            // Sync Audio
            if (audioEl && examState.audioUrl) {
                // Autoplay in content mode if not muted and paused
                if (examState.status === "content") {
                    if (!isMuted && audioEl.paused) {
                        audioEl.play().catch(() => {});
                    }
                } else if (examState.examStartTime !== null) {
                    // ... (audio logic continues)
                    const duration = audioEl.duration;
                    if (duration && !isNaN(duration) && !audioEl.paused) {
                        // Unified Sync Logic
                        const timeUntilEnd =
                            (examState.examStartTime - now) / 1000;

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
        }, 1000);

        eventSource = new EventSource("/api/events");
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            // Detect transition from timer to content
            if (examState.status === "timer" && data.status === "content") {
                // Stop and reset audio
                if (audioEl) {
                    audioEl.pause();
                    audioEl.currentTime = 0;
                    isMuted = true;
                    audioEl.muted = true;
                }
            }

            examState = data;

            // Apply Theme
            if (examState.theme === "light") {
                document.documentElement.classList.add("light-theme");
            } else {
                document.documentElement.classList.remove("light-theme");
            }
        };

        return () => {
            if (eventSource) eventSource.close();
            clearInterval(interval);
        };
    });

    function formatDuration(milliseconds: number | null) {
        if (milliseconds === null) return "--:--:--";

        const hours = Math.floor(milliseconds / 3600000);
        const minutes = Math.floor((milliseconds % 3600000) / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        return [hours, minutes, seconds]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
    }

    function formatExamTimeRemaining(milliseconds: number | null) {
        if (milliseconds === null) return "--:--:--";

        const minute = 60_000;
        let displayedMilliseconds = milliseconds;

        if (milliseconds > 30 * minute) {
            displayedMilliseconds =
                Math.ceil(milliseconds / (30 * minute)) * 30 * minute;
        } else if (milliseconds > 15 * minute) {
            displayedMilliseconds =
                Math.ceil(milliseconds / (15 * minute)) * 15 * minute;
        } else if (milliseconds > 10 * minute) {
            displayedMilliseconds =
                Math.ceil(milliseconds / (5 * minute)) * 5 * minute;
        } else if (milliseconds > 5 * minute) {
            displayedMilliseconds = Math.ceil(milliseconds / minute) * minute;
        }

        return formatDuration(displayedMilliseconds);
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

    async function renderContent(markdown: string, element?: HTMLDivElement) {
        if (element) {
            // Dynamic import for client-side only
            const { default: renderMathInElement } = await import(
                "katex/dist/contrib/auto-render.mjs"
            );

            const rawHtml = await marked.parse(markdown);
            const sanitized = DOMPurify.sanitize(rawHtml as string);
            element.innerHTML = sanitized;

            renderMathInElement(element, {
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
        void renderContent(
            examState.generalInstructions,
            generalInstructionsDiv,
        );
    });

    $effect(() => {
        void renderContent(examState.clarifications, clarificationsDiv);
    });
</script>

<!-- Background Layer -->
{#if examState.backgroundUrl}
    <!-- Hide media in Light Mode Exam View -->
    {#if examState.theme !== "light" || !showExam}
        {#if examState.backgroundUrl.endsWith(".mp4")}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
                class="bg-media"
                src={examState.backgroundUrl}
                autoplay
                loop
                muted
                playsinline
            ></video>
        {:else}
            <div
                class="bg-media"
                style="background-image: url('{examState.backgroundUrl}')"
            ></div>
        {/if}
    {/if}
{/if}

<!-- Audio Layer -->
{#if examState.audioUrl}
    <audio
        bind:this={audioEl}
        src={examState.audioUrl}
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
    {#if !showExam}
        <div class="timer-view" in:fade={{ duration: 300 }}>
            {#if examState.courseName}
                <div
                    class="course-name"
                    style={examState.theme === "light"
                        ? "color: var(--scl-gray) !important;"
                        : ""}
                >
                    {examState.courseName}
                </div>
            {/if}
            {#if examState.examTitle}
                <div class="exam-title">{examState.examTitle}</div>
            {/if}
            <div class="timer-label">Exam Starts In</div>
            <h1 class="timer-display">{startTimeString}</h1>
            <div class="server-time">Current Time: {currentTimeString}</div>
        </div>
    {:else}
        <!-- Exam View -->
        <div class="exam-view" in:fade={{ duration: 300 }}>
            <header class="top-bar">
                <div class="header-title-group">
                    {#if examState.courseName || examState.examTitle}
                        {examState.courseName}{examState.courseName && examState.examTitle
                            ? " - "
                            : ""}{examState.examTitle}
                    {/if}
                </div>
                <div
                    class="header-time header-time-remaining"
                    class:remaining-yellow={endTimeUrgency === "yellow"}
                    class:remaining-orange={endTimeUrgency === "orange"}
                    class:remaining-red={endTimeUrgency === "red"}
                >
                    <span class="header-label">Time Remaining</span>
                    <span>{endTimeString}</span>
                </div>
                <div class="header-time header-current-time">
                    <span class="header-label">Current Time</span>
                    <span>{currentTimeString}</span>
                </div>
            </header>
            <main class="content-grid">
                <section class="content-column">
                    <h1 class="content-heading">General Instructions</h1>
                    <div
                        class="content-view"
                        bind:this={generalInstructionsDiv}
                    ></div>
                </section>
                <section class="content-column">
                    <h1 class="content-heading">Clarifications</h1>
                    <div
                        class="content-view"
                        bind:this={clarificationsDiv}
                    ></div>
                </section>
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
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 2rem;
        border-bottom: none;
        color: var(--scl-white);
        font-variant-numeric: tabular-nums;
    }

    .header-time {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
        font-size: 1.5rem;
        font-weight: 600;
        white-space: nowrap;
    }

    .header-current-time {
        align-items: center;
    }

    .header-time-remaining.remaining-yellow {
        color: #fff176;
    }

    .header-time-remaining.remaining-orange {
        color: #ffb74d;
    }

    .header-time-remaining.remaining-red {
        color: #ff6b6b;
    }

    .header-label {
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        opacity: 0.8;
        text-transform: uppercase;
    }

    .header-title-group {
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--scl-gold); /* SCL_GOLD Title */
        text-align: left;
    }

    .content-grid {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        overflow-y: auto;
        width: 100%;
        box-sizing: border-box;
        background-color: var(--scl-white);
        color: var(--scl-gray);
    }

    .content-column {
        min-width: 0;
        padding: 0.75rem 2rem;
    }

    .content-column + .content-column {
        border-left: 1px solid var(--border-color);
    }

    .content-heading {
        margin: 0 0 0.5rem;
        padding-bottom: 0.25rem;
        border-bottom: 2px solid var(--scl-blue);
        color: var(--scl-gray);
        font-size: 1.25rem;
    }

    .content-view {
        font-size: 2rem;
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

    @media (max-width: 720px) {
        .top-bar {
            grid-template-columns: minmax(0, 1fr) auto auto;
            gap: 0.75rem;
            padding: 0.75rem 1rem;
        }

        .header-title-group {
            font-size: 0.8rem;
        }

        .header-time {
            font-size: 1rem;
        }

        .header-label {
            font-size: 0.55rem;
        }

        .content-grid {
            grid-template-columns: 1fr;
        }

        .content-column {
            padding: 0.75rem 1rem;
        }

        .content-column + .content-column {
            border-top: 1px solid var(--border-color);
            border-left: 0;
        }

        .content-view {
            font-size: 1.25rem;
        }
    }
</style>
