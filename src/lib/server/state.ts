import { EventEmitter } from 'events';
import type { ExamState } from '$lib/types';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export const stateEmitter = new EventEmitter();

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'exam_state.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
}

// Initial state default
const defaultState: ExamState = {
    status: 'timer',
    examStartTime: null,
    examEndTime: null,
    generalInstructions: '# Waiting for exam to start...',
    clarifications: '',
    theme: 'dark',
    backgroundUrl: '',
    audioUrl: ''
};

function loadState(): ExamState {
    try {
        if (existsSync(STATE_FILE)) {
            const raw = readFileSync(STATE_FILE, 'utf-8');
            const stored = JSON.parse(raw);

            // Preserve data created by the original single-time/single-content schema.
            if (stored.examStartTime == null && stored.targetTime != null) {
                stored.examStartTime = stored.targetTime;
            }
            if (stored.generalInstructions == null && stored.markdown != null) {
                stored.generalInstructions = stored.markdown;
            }

            delete stored.targetTime;
            delete stored.markdown;

            return { ...defaultState, ...stored };
        }
    } catch (e) {
        console.error("Failed to load state:", e);
    }
    return defaultState;
}

function saveState(state: ExamState) {
    try {
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error("Failed to save state:", e);
    }
}

export const usageState: ExamState = loadState();

export function updateState(updates: Partial<ExamState>) {
    Object.assign(usageState, updates);
    saveState(usageState);
    stateEmitter.emit('update', usageState);
}
