import test from "node:test";
import assert from "node:assert/strict";

import { buildDiaryPrompt, promptPayload } from "../api/_diary.mjs";

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
  assert.match(prompt, /Korean elementary school 2nd grade boy/);
  assert.match(prompt, /Do not create beautiful anime/);
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
