export interface ExamState {
    status: 'timer' | 'content';
    targetTime: number | null; // Timestamp for timer countdown end
    examStartTime: number | null; // When the exam started (entered content mode)
    markdown: string;
    // Version 2 features
    theme: 'dark' | 'light';
    backgroundUrl: string; // URL for MP4 or GIF
    audioUrl: string; // URL for audio file
    courseName?: string;
    examTitle?: string;
}
