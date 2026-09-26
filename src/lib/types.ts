export interface ExamState {
    status: 'timer' | 'content';
    examStartTime: number | null; // Basis of the pre-exam countdown
    examEndTime: number | null; // Basis of the in-exam time remaining
    generalInstructions: string;
    clarifications: string;
    // Version 2 features
    theme: 'dark' | 'light';
    backgroundUrl: string; // URL for MP4 or GIF
    audioUrl: string; // URL for audio file
    courseName?: string;
    examTitle?: string;
}
