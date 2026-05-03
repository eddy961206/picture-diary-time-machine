import test from "node:test";
import assert from "node:assert/strict";

import { buildDiaryPrompt, formatKoreanDiaryDate, promptPayload } from "../api/_diary.mjs";

function createRequest(body) {
  return { body };
}

test("buildDiaryPrompt accepts one tiny diary line", () => {
  const prompt = buildDiaryPrompt({
    diary: "퇴근하고 편의점 라면 먹음",
    moodType: "funny",
  });

  assert.match(prompt, /퇴근하고 편의점 라면 먹음/);
  assert.match(prompt, /라면을 먹었다/);
  assert.match(prompt, /Korean elementary school 2nd grade child/);
  assert.match(prompt, /Do not imply a fixed gender/);
  assert.doesNotMatch(prompt, /남자아이|boy/);
  assert.match(prompt, /Do not create beautiful anime/);
  assert.doesNotMatch(prompt, /Date field: 오늘/);
  assert.match(prompt, /Never write “오늘” in the date field/);
});

test("buildDiaryPrompt uses explicit Korean date format and optional header fields", () => {
  assert.equal(formatKoreanDiaryDate(new Date("2026-05-01T02:00:00.000Z")), "2026년 05월 01일 금요일");

  const prompt = buildDiaryPrompt({
    diary: "퇴근하고 비를 맞았다",
    date: "2026년 05월 01일 금요일",
    weather: "비",
    title: "비 맞은 날",
  });

  assert.match(prompt, /Date field: write exactly “2026년 05월 01일 금요일”/);
  assert.match(prompt, /Weather field: write exactly “비”/);
  assert.match(prompt, /Title field: write exactly “비 맞은 날”/);
});

test("buildDiaryPrompt supports exact user text mode", () => {
  const prompt = buildDiaryPrompt({
    diary: "오늘은 회사에서 일이 많았다.\n집에 와서 라면을 먹었다.",
    textMode: "exact",
  });

  assert.match(prompt, /Text mode: exact user text/);
  assert.match(prompt, /Copy every Korean sentence/);
  assert.match(prompt, /Do not summarize, rewrite/);
  assert.match(prompt, /오늘은 회사에서 일이 많았다/);
  assert.doesNotMatch(prompt, /Rewrite the diary text yourself/);
});

test("buildDiaryPrompt rejects empty daily note", () => {
  assert.throws(() => buildDiaryPrompt({ diary: "" }), {
    message: "오늘 한 줄만 써줘. 진짜 짧아도 괜찮아.",
  });
});

test("promptPayload does not expose the generated prompt", async () => {
  const payload = await promptPayload(createRequest({ diary: "산책함" }));

  assert.equal(payload.ok, false);
  assert.equal("prompt" in payload, false);
  assert.match(payload.error, /프롬프트를 보여주지 않아/);
});
