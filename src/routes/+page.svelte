<script lang="ts">
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import { marked } from "marked";
    import DOMPurify from "dompurify";
    import { Volume2, VolumeX } from "lucide-svelte";
    import type { ExamState } from "$lib/types";
    import { createServerClock } from "$lib/server-clock.js";
    import {
        formatCurrentTime,
        formatDuration,
        formatExamTimeRemaining,
        getExamTimeUrgency,
    } from "$lib/time-format.js";

    let examState: ExamState = $state({
        examStartTime: null,
        examEndTime: null,
        preExamInstructions: "",
        generalInstructions: "",
        clarifications: "",
        theme: "dark",
        backgroundType: "image",
        backgroundUrl: "",
        audioUrl: "",
    });

    let now: number | null = $state(null);
    let hostTimeZone: string | null = $state(null);
    let preExamInstructionsDiv: HTMLDivElement | undefined = $state();
    let generalInstructionsDiv: HTMLDivElement | undefined = $state();
    let clarificationsDiv: HTMLDivElement | undefined = $state();
    let clarificationSlideIndex = $state(0);
    let clarificationSlideSeconds = $state(0);

    // Multimedia
    let audioEl: HTMLAudioElement | undefined = $state();
    let isMuted = $state(true); // Default to muted for policy compliance
    let dingEnabled = $state(false);
    let dingPending = $state(false);
    let dingContext: AudioContext | undefined;
    // SSE connection
    let eventSource: EventSource;

    const startTimeLeft = $derived(
        examState.examStartTime === null || now === null
            ? null
            : Math.max(0, examState.examStartTime - now),
    );
    const endTimeLeft = $derived(
        examState.examEndTime === null || now === null
            ? null
            : Math.max(0, examState.examEndTime - now),
    );
    const showExam = $derived(
        now !== null && examState.examStartTime !== null && startTimeLeft === 0,
    );
    const startTimeString = $derived(formatDuration(startTimeLeft));
    const endTimeString = $derived(formatExamTimeRemaining(endTimeLeft));
    const endTimeUrgency = $derived(getExamTimeUrgency(endTimeLeft));
    const currentTimeString = $derived(formatCurrentTime(now, hostTimeZone ?? undefined));
    const clarificationSlides = $derived(
        groupClarifications(examState.clarifications),
    );
    const activeClarification = $derived(
        clarificationSlides[clarificationSlideIndex] ?? "",
    );

    onMount(() => {
        let active = true;
        const clock = createServerClock(async () => {
            const response = await fetch("/api/time", { cache: "no-store" });
            if (!response.ok) throw new Error("Host time unavailable");
            return response.json();
        });
        const syncTime = async () => {
            try {
                await clock.sync();
                if (active) {
                    hostTimeZone = clock.timeZone;
                    now = clock.now();
                }
            } catch {
                // Keep the previous host sample, or the unsynchronized placeholder; retry later.
            }
        };
        void syncTime();
        const resyncInterval = setInterval(() => { void syncTime(); }, 30_000);
        const onVisibilityChange = () => {
            if (!document.hidden) void syncTime();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        const displayInterval = setInterval(() => { now = clock.now(); }, 100);
        const interval = setInterval(() => {
            if (showExam && clarificationSlides.length > 1) {
                clarificationSlideSeconds += 1;
                if (clarificationSlideSeconds >= 10) {
                    clarificationSlideIndex =
                        (clarificationSlideIndex + 1) %
                        clarificationSlides.length;
                    clarificationSlideSeconds = 0;
                }
            } else {
                clarificationSlideIndex = 0;
                clarificationSlideSeconds = 0;
            }

            // Sync Audio
            if (now !== null && audioEl && examState.audioUrl) {
                if (showExam) {
                    audioEl.pause();
                    audioEl.currentTime = 0;
                    isMuted = true;
                    audioEl.muted = true;
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

        let receivedState = false;
        eventSource = new EventSource("/api/events");
        eventSource.onmessage = (event) => {
            const data: ExamState = JSON.parse(event.data);
            if (receivedState && (
                data.generalInstructions !== examState.generalInstructions ||
                data.clarifications !== examState.clarifications ||
                data.examEndTime !== examState.examEndTime
            )) playDing();
            receivedState = true;
            if (data.clarifications !== examState.clarifications) {
                clarificationSlideIndex = 0;
                clarificationSlideSeconds = 0;
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
            active = false;
            document.removeEventListener("visibilitychange", onVisibilityChange);
            clearInterval(resyncInterval);
            clearInterval(displayInterval);
            if (eventSource) eventSource.close();
            clearInterval(interval);
            dingEnabled = false;
            void dingContext?.close().catch(() => {});
        };
    });

    async function toggleDing() {
        if (dingEnabled) {
            dingEnabled = false;
            return;
        }
        if (!window.AudioContext) return;
        dingPending = true;
        try {
            dingContext ??= new AudioContext();
            await dingContext.resume();
            dingEnabled = dingContext.state === "running";
        } catch {
            dingEnabled = false;
        } finally {
            dingPending = false;
        }
    }

    function playDing() {
        if (!dingEnabled || dingContext?.state !== "running") return;
        try {
            const start = dingContext.currentTime;
            const oscillator = dingContext.createOscillator();
            const gain = dingContext.createGain();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(660, start);
            oscillator.frequency.exponentialRampToValueAtTime(880, start + 0.12);
            gain.gain.setValueAtTime(0.001, start);
            gain.gain.exponentialRampToValueAtTime(0.025, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
            oscillator.connect(gain);
            gain.connect(dingContext.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.24);
            oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        } catch {
            // Audio may become unavailable without interrupting live updates.
        }
    }

    function groupClarifications(markdown: string) {
        const linesPerSlide = 8;
        const slides: string[] = [];
        let slideLines: string[] = [];
        let populatedLines = 0;

        const finishSlide = () => {
            const slide = slideLines.join("\n").trim();
            if (slide) slides.push(slide);
            slideLines = [];
            populatedLines = 0;
        };

        for (const line of markdown.split("\n")) {
            if (/^\s*---+\s*$/.test(line)) {
                finishSlide();
                continue;
            }

            if (line.trim() && populatedLines >= linesPerSlide) {
                finishSlide();
            }

            slideLines.push(line);
            if (line.trim()) populatedLines += 1;
        }

        finishSlide();
        return slides.length > 0 ? slides : [""];
    }

    function toggleMute() {
        if (!audioEl || now === null) return;
        isMuted = !isMuted;
        audioEl.muted = isMuted;
        if (!isMuted) {
            // Try to play immediately if we are in the window
            audioEl.play().catch((e) => console.error("Play failed", e));
        }
    }

    function fitInstructions(element: HTMLDivElement) {
        let frame = 0;
        let destroyed = false;
        const fit = () => {
            frame = 0;
            element.style.fontSize = "";
            const maximum = parseFloat(getComputedStyle(element).fontSize);
            const minimum = Math.min(16, maximum);
            const fits = () =>
                element.scrollHeight <= element.clientHeight + 1 &&
                element.scrollWidth <= element.clientWidth + 1;

            if (fits()) return;
            element.style.fontSize = `${minimum}px`;
            if (!fits()) return; // Keep readable text scrollable when even the floor cannot fit.

            let low = minimum;
            let high = maximum;
            while (high - low > 0.25) {
                const middle = (low + high) / 2;
                element.style.fontSize = `${middle}px`;
                if (fits()) low = middle;
                else high = middle;
            }
            element.style.fontSize = `${low}px`;
        };
        const schedule = () => {
            if (destroyed) return;
            if (!frame) frame = requestAnimationFrame(fit);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        if (element.parentElement) observer.observe(element.parentElement);
        const mutations = new MutationObserver(schedule);
        mutations.observe(element, { childList: true, subtree: true });
        element.addEventListener("load", schedule, true); // Images in authored markdown.
        window.addEventListener("resize", schedule);
        document.fonts?.addEventListener("loadingdone", schedule);
        void document.fonts?.ready.then(schedule);
        schedule();

        return {
            destroy() {
                destroyed = true;
                cancelAnimationFrame(frame);
                observer.disconnect();
                mutations.disconnect();
                element.removeEventListener("load", schedule, true);
                window.removeEventListener("resize", schedule);
                document.fonts?.removeEventListener("loadingdone", schedule);
            },
        };
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
            examState.preExamInstructions,
            preExamInstructionsDiv,
        );
    });

    $effect(() => {
        void renderContent(
            examState.generalInstructions,
            generalInstructionsDiv,
        );
    });

    $effect(() => {
        void renderContent(activeClarification, clarificationsDiv);
    });
</script>

<!-- Background Layer -->
{#if examState.backgroundUrl && !showExam}
    {#if examState.backgroundType === "video"}
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

<!-- The audio element also accepts supported video sources without rendering video. -->
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

<button
    class="ding-toggle"
    onclick={toggleDing}
    disabled={dingPending || typeof AudioContext === "undefined"}
    aria-pressed={dingEnabled}
>
    {dingEnabled ? "Mute update ding" : "Enable update ding"}
</button>

<div class="page-container">
    {#if !showExam}
        <div class="timer-view" in:fade={{ duration: 300 }}>
            <header class="preexam-title-row">
                <div class="preexam-logo-wrap">
                    <img
                        class="preexam-logo"
                        src="/uploads/b1ffa2d2-636d-4719-8056-b2a40b1ef44c.png"
                        alt="University of the Philippines, College of Engineering, and Department of Computer Science logos"
                    />
                </div>
                {#if examState.courseName || examState.examTitle}
                    <div class="preexam-title-text">
                        {examState.courseName}{examState.courseName && examState.examTitle
                            ? " - "
                            : ""}{examState.examTitle}
                    </div>
                {/if}
            </header>
            <div class="preexam-content-row">
                <section class="preexam-countdown-column">
                    <div class="timer-label">Exam Starts In</div>
                    <h1 class="timer-display">{startTimeString}</h1>
                    <div class="server-time">
                        Current Time: {currentTimeString}
                    </div>
                </section>
                <section
                    class="preexam-instructions-panel"
                    class:light-panel={examState.theme === "light"}
                >
                    <h2>Pre-exam Instructions</h2>
                    <div
                        class="preexam-instructions-content"
                        bind:this={preExamInstructionsDiv}
                        use:fitInstructions
                    ></div>
                </section>
            </div>
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
                <section class="content-column general-instructions-column">
                    <h1 class="content-heading">General Instructions</h1>
                    <div
                        class="content-view general-instructions-content"
                        bind:this={generalInstructionsDiv}
                        use:fitInstructions
                    ></div>
                </section>
                <section class="content-column clarification-column">
                    <h1 class="content-heading">Clarifications</h1>
                    <div class="clarification-slide-frame">
                        {#key clarificationSlideIndex}
                            <div
                                class="content-view clarification-slide"
                                bind:this={clarificationsDiv}
                                in:fade={{ duration: 300 }}
                                out:fade={{ duration: 300 }}
                            ></div>
                        {/key}
                        <div
                            class="slide-counter"
                            aria-label={`Clarification slide ${clarificationSlideIndex + 1} of ${clarificationSlides.length}`}
                        >
                            {clarificationSlideIndex + 1} / {clarificationSlides.length}
                        </div>
                    </div>
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
        opacity: 1;
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

    .ding-toggle {
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 100;
        min-height: 48px;
        padding: 0 1rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 24px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        cursor: pointer;
    }

    /* Timer View */
    .timer-view {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        position: relative;
        padding: 1rem 5vw 2rem;
        box-sizing: border-box;
        background: transparent;
        overflow-y: auto;
    }

    .preexam-title-row {
        width: 100%;
        padding: 0;
        box-sizing: border-box;
        text-align: center;
    }

    .preexam-logo-wrap {
        width: clamp(15rem, 25vw, 21rem);
        max-width: 92%;
        margin: 0 auto clamp(2rem, 4vh, 3rem);
        overflow: hidden;
        background: #0b5742;
    }

    .preexam-logo {
        display: block;
        width: 100%;
        height: auto;
        border-radius: 0.25rem;
    }

    .preexam-title-text {
        overflow: hidden;
        color: var(--scl-white);
        font-size: clamp(1.7rem, 3.5vw, 3.75rem);
        font-weight: 800;
        letter-spacing: 0.05em;
        line-height: 1.1;
        text-overflow: ellipsis;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
        text-transform: uppercase;
        white-space: nowrap;
    }

    .preexam-content-row {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(22rem, 3fr);
        gap: clamp(4rem, 6vw, 6rem);
        align-items: stretch;
        margin-top: 1rem;
    }

    .preexam-countdown-column {
        display: flex;
        min-width: 0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .preexam-instructions-panel {
        width: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        padding: 1.5rem 1.75rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 14px;
        background: rgba(13, 17, 23, 0.5);
        color: var(--text-color);
        backdrop-filter: blur(6px);
    }

    .preexam-instructions-panel.light-panel {
        border-color: rgba(30, 35, 40, 0.18);
        background: rgba(255, 255, 255, 0.5);
        color: var(--scl-gray);
    }

    .preexam-instructions-panel h2 {
        flex: none;
        margin: 0 0 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid #0b5742;
        font-size: clamp(1.65rem, 2.2vw, 2.1rem);
    }

    .preexam-instructions-content {
        flex: 1;
        min-height: 0;
        display: flow-root;
        overflow: auto;
        font-size: clamp(1.6rem, 2.2vw, 2rem);
        line-height: 1.5;
    }

    :global(.preexam-instructions-content img),
    :global(.general-instructions-content img) {
        max-width: 100%;
        height: auto;
    }

    :global(.preexam-instructions-content > :first-child) {
        margin-top: 0;
    }

    :global(.preexam-instructions-content > :last-child) {
        margin-bottom: 0;
    }

    .timer-label {
        font-size: 1.5rem;
        color: var(--scl-white);
        opacity: 0.9;
        margin-bottom: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
    }

    .timer-display {
        max-width: 100%;
        font-size: clamp(2.5rem, 6vw, 6rem);
        font-weight: 800;
        margin: 0;
        font-variant-numeric: tabular-nums;
        color: var(--scl-gold);
        text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
    }

    .server-time {
        margin-top: 2rem;
        font-size: 1.2rem;
        color: var(--scl-white);
        opacity: 0.85;
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
        padding: 1.5rem 2rem;
        background-color: #0b5742;
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
        font-size: 2.1rem;
        font-weight: 600;
        white-space: nowrap;
    }

    .header-current-time {
        justify-self: end;
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
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        opacity: 0.8;
        text-transform: uppercase;
    }

    .header-title-group {
        min-width: 0;
        overflow: hidden;
        font-size: clamp(0.9rem, 1.7vw, 1.25rem);
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--scl-white);
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .content-grid {
        flex: 1;
        min-height: 0;
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

    .general-instructions-column {
        display: flex;
        min-height: 0;
        flex-direction: column;
    }

    .general-instructions-content {
        flex: 1;
        min-height: 0;
        display: flow-root;
        overflow: auto;
    }

    .content-column + .content-column {
        border-left: 1px solid var(--border-color);
    }

    .clarification-column {
        display: flex;
        min-height: 0;
        flex-direction: column;
    }

    .clarification-slide-frame {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        padding-bottom: 2rem;
    }

    .clarification-slide {
        height: 100%;
        overflow: auto;
    }

    .slide-counter {
        position: absolute;
        right: 0;
        bottom: 0;
        color: var(--scl-gray);
        font-size: 0.9rem;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        opacity: 0.65;
    }

    .content-heading {
        margin: 0 0 0.5rem;
        padding-bottom: 0.25rem;
        border-bottom: 2px solid #0b5742;
        color: #0b5742;
        font-size: clamp(1.65rem, 2.2vw, 2.1rem);
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
        .timer-view {
            overflow-y: auto;
            padding: 1.5rem 1rem;
        }

        .preexam-content-row {
            flex: none;
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .preexam-instructions-panel {
            height: max(12rem, calc(100dvh - 11rem));
        }

        .top-bar {
            grid-template-columns: minmax(0, 1fr) auto auto;
            gap: 0.75rem;
            padding: 1rem;
        }

        .header-title-group {
            font-size: clamp(0.65rem, 2.2vw, 1rem);
        }

        .header-time {
            font-size: 1.4rem;
        }

        .header-label {
            font-size: 0.68rem;
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
