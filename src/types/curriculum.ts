export interface DeepDiveData {
  overview: string;
  code: string;
  language: string;
  tips: string[];
}

export interface Lesson {
  day: number;
  topic: string;
  category: string;
  readMinutes: number;
  content: string;
  codeExample?: string;
  codeLanguage?: string;
  question: string;
  options: [string, string, string, string];
  correct_answer: string;
  explanation: string;
  isPreinstalled?: boolean;
  deepDive?: DeepDiveData;
}

export interface WeeklyQuizQuestion {
  day: number;
  topic: string;
  question: string;
  options: [string, string, string, string];
  correct_answer: string;
  explanation: string;
}

export interface WeeklyQuiz {
  weekNumber: number;
  day: number;
  title: string;
  questions: WeeklyQuizQuestion[];
}

export interface UserProgress {
  uid: string;
  displayName?: string;
  email?: string;
  unlockedDay: number;
  completedDays: number[];
  lastCompletedAt: number; // Unix ms, 0 if none completed yet
  correctAnswers: number;
  totalAnswered: number;
  streakDays: number;
  gatePassedForDay: number; // Highest day whose daily gate has been passed (1 initially)
  fastTrackMode: boolean;
}

export interface UserSettings {
  customApiKey: string;
  customBaseUrl: string;
}

export interface QuizResultRecord {
  id: string;
  day: number;
  quizType: 'daily' | 'weekly';
  score: number;
  total: number;
  passed: boolean;
  completedAtMs: number;
}

export type AssistantDepthLevel = 1 | 2 | 3 | 4;

export interface MasteryProfile {
  level: AssistantDepthLevel;
  label: 'Старт' | 'Практик' | 'Инженер' | 'Архитектор';
  depthHint: string;
  currentDay: number;
  currentTopic: string;
  currentCategory: string;
  completedTopics: string[];
  accuracyPercent: number;
  suggestedPrompts: string[];
}

export interface AssistantReply {
  answer: string;
  keyTakeaways: string[];
  codeSnippet?: string;
  codeLanguage?: string;
  nextDepthSuggestions: string[];
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  keyTakeaways?: string[];
  codeSnippet?: string;
  codeLanguage?: string;
  nextDepthSuggestions?: string[];
  depthLabel?: string;
  createdAtMs: number;
}
