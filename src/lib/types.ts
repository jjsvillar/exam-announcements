export interface ExamState {
    examStartTime: number | null; // Basis of the pre-exam countdown
    examEndTime: number | null; // Basis of the in-exam time remaining
    generalInstructions: string;
    clarifications: string;
    // Version 2 features
    theme: 'dark' | 'light';
    backgroundType: 'image' | 'video';
    backgroundUrl: string; // Uploaded image path or direct video URL
    audioUrl: string; // Uploaded media path or direct media URL; only audio is played
    courseName?: string;
    examTitle?: string;
}
