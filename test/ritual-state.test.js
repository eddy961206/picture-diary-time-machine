import test from "node:test";
import assert from "node:assert/strict";

import {
  getSeoulDateKey,
  getStreakReward,
  getTodayRitualState,
  MAX_DAILY_GENERATIONS,
  remainingGenerations,
  RITUAL_STORAGE_KEY,
  saveSuccessfulGeneration,
} from "../public/ritual-state.js";

function createMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
  };
}

test("getSeoulDateKey uses Asia/Seoul day boundary", () => {
  assert.equal(getSeoulDateKey(new Date("2026-04-28T15:10:00.000Z")), "2026-04-29");
});

test("daily generation limit counts successful generations only when recorded", () => {
  const storage = createMemoryStorage();
  const now = new Date("2026-04-29T03:00:00.000Z");

  assert.equal(remainingGenerations(getTodayRitualState({ now, storage })), MAX_DAILY_GENERATIONS);
  saveSuccessfulGeneration({ now, storage });
  assert.equal(remainingGenerations(getTodayRitualState({ now, storage })), 1);
  saveSuccessfulGeneration({ now, storage });
  assert.equal(remainingGenerations(getTodayRitualState({ now, storage })), 0);
  saveSuccessfulGeneration({ now, storage });
  assert.equal(remainingGenerations(getTodayRitualState({ now, storage })), 0);
});

test("streak rewards follow diary notebook milestones", () => {
  assert.equal(getStreakReward(0), "그림일기장 시작 전");
  assert.equal(getStreakReward(3), "작심삼일 성공");
  assert.equal(getStreakReward(7), "그림일기 1주차 완성");
  assert.equal(getStreakReward(14), "일기장 절반 채움");
  assert.equal(getStreakReward(30), "여름방학 그림일기장 완성");
});

test("new Seoul day resets daily count but keeps streak source", () => {
  const storage = createMemoryStorage({
    [RITUAL_STORAGE_KEY]: JSON.stringify({
      dateKey: "2026-04-29",
      generations: 2,
      streak: 1,
      lastCompletedDateKey: "2026-04-29",
    }),
  });

  const state = getTodayRitualState({
    now: new Date("2026-04-29T15:10:00.000Z"),
    storage,
  });

  assert.equal(state.dateKey, "2026-04-30");
  assert.equal(state.generations, 0);
  assert.equal(state.streak, 1);
});
