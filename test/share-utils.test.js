import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAppShareUrl,
  buildSocialShareUrl,
  buildInviteUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getInviteCodeFromUrl,
  getSharePageUrl,
  normalizeInviteCode,
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

test("buildInviteUrl adds a sanitized invite code to the share page", () => {
  const location = {
    origin: "https://example.com",
    pathname: "/diary",
    search: "?draft=1",
    hash: "#result",
  };

  assert.equal(buildInviteUrl(" ab-cd 12 ", location), "https://example.com/diary?invite=ABCD12");
});

test("getInviteCodeFromUrl accepts invite aliases", () => {
  assert.equal(getInviteCodeFromUrl({ search: "?invite=ab12-cd" }), "AB12CD");
  assert.equal(getInviteCodeFromUrl({ search: "?invite_code=xy987" }), "XY987");
  assert.equal(getInviteCodeFromUrl({ search: "?code=hello999999999" }), "HELLO9999999");
});

test("normalizeInviteCode removes unsupported characters", () => {
  assert.equal(normalizeInviteCode(" 초대-ab12!! "), "AB12");
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

test("buildAppShareUrl creates mobile app deep links", () => {
  const text = "초대 코드 ABCD12";
  const url = "https://example.com/diary?invite=ABCD12";

  assert.equal(
    buildAppShareUrl("kakao", { text, url }),
    "kakaotalk://sendurl?msg=%EC%B4%88%EB%8C%80%20%EC%BD%94%EB%93%9C%20ABCD12&url=https%3A%2F%2Fexample.com%2Fdiary%3Finvite%3DABCD12",
  );
  assert.equal(
    buildAppShareUrl("x", { text, url }),
    "twitter://post?message=%EC%B4%88%EB%8C%80%20%EC%BD%94%EB%93%9C%20ABCD12%20https%3A%2F%2Fexample.com%2Fdiary%3Finvite%3DABCD12",
  );
  assert.equal(
    buildAppShareUrl("instagram", { text, url }),
    "instagram://sharesheet?text=%EC%B4%88%EB%8C%80%20%EC%BD%94%EB%93%9C%20ABCD12%20https%3A%2F%2Fexample.com%2Fdiary%3Finvite%3DABCD12",
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
