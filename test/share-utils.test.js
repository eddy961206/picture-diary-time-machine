import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getSharePageUrl,
} from "../public/share-utils.js";

test("createImageFilename uses timestamp and extension", () => {
  assert.equal(createImageFilename("png", 1700000000000), "picture-diary-1700000000000.png");
  assert.equal(createImageFilename("jpeg", 1700000000000), "picture-diary-1700000000000.jpeg");
});

test("getSharePageUrl strips hash and query from the current page", () => {
  const location = {
    origin: "https://example.com",
    pathname: "/diary",
    search: "?draft=1",
    hash: "#result",
  };

  assert.equal(getSharePageUrl(location), "https://example.com/diary");
});

test("buildSocialShareUrl creates encoded SNS links for X and Threads", () => {
  const text = "그림일기 타임머신";
  const url = "https://example.com/diary";

  assert.equal(
    buildSocialShareUrl("x", { text, url }),
    "https://twitter.com/intent/tweet?text=%EA%B7%B8%EB%A6%BC%EC%9D%BC%EA%B8%B0%20%ED%83%80%EC%9E%84%EB%A8%B8%EC%8B%A0&url=https%3A%2F%2Fexample.com%2Fdiary",
  );
  assert.equal(
    buildSocialShareUrl("threads", { text, url }),
    "https://www.threads.net/intent/post?text=%EA%B7%B8%EB%A6%BC%EC%9D%BC%EA%B8%B0%20%ED%83%80%EC%9E%84%EB%A8%B8%EC%8B%A0%20https%3A%2F%2Fexample.com%2Fdiary",
  );
});

test("buildSocialShareUrl rejects removed SNS targets", () => {
  assert.throws(
    () => buildSocialShareUrl("facebook", { text: "text", url: "https://example.com" }),
    { message: "지원하지 않는 공유 대상입니다." },
  );
});

test("createImageFileFromDataUrl converts a PNG data URL into a File-like object", async () => {
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  const file = await createImageFileFromDataUrl(dataUrl, "diary.png");

  assert.equal(file.name, "diary.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 5);
  assert.equal(await file.text(), "hello");
});

test("createImageFileFromDataUrl rejects non-data URLs", async () => {
  await assert.rejects(() => createImageFileFromDataUrl("/sample-output.png", "diary.png"), {
    message: "공유할 수 있는 생성 이미지가 아닙니다.",
  });
});
