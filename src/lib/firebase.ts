import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { Lesson, QuizResultRecord, UserProgress } from '../types/curriculum';
import { createInitialProgress } from './curriculumEngine';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function subscribeAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logoutFirebase() {
  await signOut(auth);
}

function clampStr(val: string | undefined, max: number): string {
  if (!val) return '';
  return val.slice(0, max);
}

export async function loadUserProgressFromFirestore(uid: string): Promise<UserProgress | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid: String(data.uid || uid),
      displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      unlockedDay: Number(data.unlockedDay || 1),
      completedDays: Array.isArray(data.completedDays)
        ? data.completedDays.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
        : [],
      lastCompletedAt: Number(data.lastCompletedAt || 0),
      correctAnswers: Number(data.correctAnswers || 0),
      totalAnswered: Number(data.totalAnswered || 0),
      streakDays: Number(data.streakDays || 0),
      gatePassedForDay: Number(data.gatePassedForDay || 1),
      fastTrackMode: Boolean(data.fastTrackMode),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProgressToFirestore(
  progress: UserProgress,
  user: User
): Promise<void> {
  const path = `users/${user.uid}`;
  const safeCompleted = progress.completedDays.slice(0, 365);
  const safeTotal = Math.max(0, Math.round(progress.totalAnswered));
  const safeCorrect = Math.min(safeTotal, Math.max(0, Math.round(progress.correctAnswers)));

  const payload = {
    uid: user.uid,
    displayName: clampStr(user.displayName || progress.displayName || 'AI Инженер', 120),
    email: clampStr(user.email || progress.email || '', 200),
    unlockedDay: Math.min(365, Math.max(1, Math.round(progress.unlockedDay))),
    completedDays: safeCompleted,
    lastCompletedAt: Math.max(0, Math.round(progress.lastCompletedAt)),
    correctAnswers: safeCorrect,
    totalAnswered: safeTotal,
    streakDays: Math.min(365, Math.max(0, Math.round(progress.streakDays))),
    gatePassedForDay: Math.min(365, Math.max(0, Math.round(progress.gatePassedForDay))),
    fastTrackMode: Boolean(progress.fastTrackMode),
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = doc(db, 'users', user.uid);
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, payload);
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function ensureUserProgressDocument(
  user: User,
  localFallback: UserProgress
): Promise<UserProgress> {
  const existing = await loadUserProgressFromFirestore(user.uid);
  if (existing) return existing;

  const seeded: UserProgress = {
    ...createInitialProgress(user.uid),
    ...localFallback,
    uid: user.uid,
    displayName: user.displayName || undefined,
    email: user.email || undefined,
  };
  await saveUserProgressToFirestore(seeded, user);
  return seeded;
}

export async function loadUserLessonsFromFirestore(uid: string): Promise<Record<number, Lesson>> {
  const path = `users/${uid}/lessons`;
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'lessons'));
    const map: Record<number, Lesson> = {};
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const day = Number(d.day);
      if (!Number.isInteger(day) || day < 1) return;
      const opts = Array.isArray(d.options) ? d.options.map(String) : [];
      if (opts.length !== 4) return;
      map[day] = {
        day,
        topic: String(d.topic || ''),
        category: String(d.category || 'AI Инженерия'),
        readMinutes: Number(d.readMinutes || 5),
        content: String(d.content || ''),
        codeExample: typeof d.codeExample === 'string' ? d.codeExample : undefined,
        codeLanguage: typeof d.codeLanguage === 'string' ? d.codeLanguage : 'typescript',
        question: String(d.question || ''),
        options: opts as [string, string, string, string],
        correct_answer: String(d.correctAnswer || ''),
        explanation: String(d.explanation || ''),
        isPreinstalled: day <= 5,
        deepDive:
          typeof d.deepDiveOverview === 'string' && d.deepDiveOverview.length > 0
            ? {
                overview: String(d.deepDiveOverview),
                code: String(d.deepDiveCode || ''),
                language: String(d.deepDiveLanguage || 'typescript'),
                tips: Array.isArray(d.deepDiveTips) ? d.deepDiveTips.map(String) : [],
              }
            : undefined,
      };
    });
    return map;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveLessonToFirestore(uid: string, lesson: Lesson): Promise<void> {
  const dayId = String(lesson.day);
  const path = `users/${uid}/lessons/${dayId}`;
  const ref = doc(db, 'users', uid, 'lessons', dayId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const createPayload: Record<string, unknown> = {
        ownerUid: uid,
        day: lesson.day,
        topic: clampStr(lesson.topic, 240),
        category: clampStr(lesson.category || 'AI Инженерия', 80),
        readMinutes: Math.min(60, Math.max(1, Math.round(lesson.readMinutes || 5))),
        content: clampStr(lesson.content, 20000),
        question: clampStr(lesson.question, 1000),
        options: lesson.options.slice(0, 4).map((o) => clampStr(o, 400)),
        correctAnswer: clampStr(lesson.correct_answer, 1000),
        explanation: clampStr(lesson.explanation, 3000),
        updatedAt: serverTimestamp(),
      };
      if (lesson.codeExample) {
        createPayload.codeExample = clampStr(lesson.codeExample, 8000);
        createPayload.codeLanguage = clampStr(lesson.codeLanguage || 'typescript', 32);
      }
      if (lesson.deepDive) {
        createPayload.deepDiveOverview = clampStr(lesson.deepDive.overview, 15000);
        createPayload.deepDiveCode = clampStr(lesson.deepDive.code, 8000);
        createPayload.deepDiveLanguage = clampStr(lesson.deepDive.language || 'typescript', 32);
        createPayload.deepDiveTips = lesson.deepDive.tips.slice(0, 10).map((t) => clampStr(t, 500));
      }
      await setDoc(ref, createPayload);
    } else if (lesson.deepDive) {
      await updateDoc(ref, {
        deepDiveOverview: clampStr(lesson.deepDive.overview, 15000),
        deepDiveCode: clampStr(lesson.deepDive.code, 8000),
        deepDiveLanguage: clampStr(lesson.deepDive.language || 'typescript', 32),
        deepDiveTips: lesson.deepDive.tips.slice(0, 10).map((t) => clampStr(t, 500)),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveQuizResultToFirestore(
  uid: string,
  result: QuizResultRecord
): Promise<void> {
  const path = `users/${uid}/quizResults/${result.id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'quizResults', result.id), {
      ownerUid: uid,
      day: result.day,
      quizType: result.quizType,
      score: Math.max(0, result.score),
      total: Math.max(1, Math.min(20, result.total)),
      passed: Boolean(result.passed),
      completedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function loadQuizResultsFromFirestore(uid: string): Promise<QuizResultRecord[]> {
  const path = `users/${uid}/quizResults`;
  try {
    const q = query(
      collection(db, 'users', uid, 'quizResults'),
      orderBy('completedAt', 'desc'),
      limit(30)
    );
    const snap = await getDocs(q);
    const results: QuizResultRecord[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const ts = d.completedAt?.toMillis ? d.completedAt.toMillis() : Date.now();
      results.push({
        id: docSnap.id,
        day: Number(d.day || 1),
        quizType: d.quizType === 'weekly' ? 'weekly' : 'daily',
        score: Number(d.score || 0),
        total: Number(d.total || 1),
        passed: Boolean(d.passed),
        completedAtMs: ts,
      });
    });
    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
