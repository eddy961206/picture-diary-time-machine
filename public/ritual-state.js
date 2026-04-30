export const MAX_DAILY_GENERATIONS = 2;
export const RITUAL_STORAGE_KEY = "pictureDiaryRitual:v1";

export const SHARE_LINES = [
  "오늘 내 하루가 초딩 그림일기가 됨",
  "오늘의 방학숙제 제출함",
  "선생님 저 오늘도 살았어요",
];

export const LOADING_LINES = [
  "일기장에 색칠하는 중...",
  "삐뚤빼뚤 글씨 쓰는 중...",
  "선생님 몰래 다시 그리는 중...",
];

export function getSeoulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function readRitualState(storage = globalThis.localStorage) {
  const parsed = JSON.parse(storage.getItem(RITUAL_STORAGE_KEY) || "{}");
  return {
    dateKey: parsed.dateKey || "",
    generations: Number(parsed.generations || 0),
    streak: Number(parsed.streak || 0),
    lastCompletedDateKey: parsed.lastCompletedDateKey || "",
  };
}

export function writeRitualState(state, storage = globalThis.localStorage) {
  storage.setItem(RITUAL_STORAGE_KEY, JSON.stringify(state));
}

export function getTodayRitualState({
  now = new Date(),
  storage = globalThis.localStorage,
} = {}) {
  const today = getSeoulDateKey(now);
  const state = readRitualState(storage);
  if (state.dateKey !== today) {
    state.dateKey = today;
    state.generations = 0;
  }
  return state;
}

export function remainingGenerations(state) {
  return Math.max(0, MAX_DAILY_GENERATIONS - state.generations);
}

export function saveSuccessfulGeneration({
  now = new Date(),
  storage = globalThis.localStorage,
} = {}) {
  const today = getSeoulDateKey(now);
  const state = getTodayRitualState({ now, storage });
  state.generations = Math.min(MAX_DAILY_GENERATIONS, state.generations + 1);

  if (state.lastCompletedDateKey !== today) {
    state.streak = daysBetween(state.lastCompletedDateKey, today) === 1 ? state.streak + 1 : 1;
    state.lastCompletedDateKey = today;
  }

  writeRitualState(state, storage);
  return state;
}

export function getStreakReward(streak) {
  if (streak >= 30) return "여름방학 그림일기장 완성";
  if (streak >= 14) return "일기장 절반 채움";
  if (streak >= 7) return "방학숙제 1주차 완성";
  if (streak >= 3) return "작심삼일 성공";
  if (streak >= 1) return "오늘의 숙제 완료";
  return "방학숙제장 시작 전";
}

function daysBetween(dateKeyA, dateKeyB) {
  if (!dateKeyA || !dateKeyB) return Number.POSITIVE_INFINITY;
  const a = new Date(`${dateKeyA}T00:00:00+09:00`);
  const b = new Date(`${dateKeyB}T00:00:00+09:00`);
  return Math.round((b - a) / 86400000);
}
