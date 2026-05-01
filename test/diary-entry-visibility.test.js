import test from "node:test";
import assert from "node:assert/strict";

import { getVisibleDiaryEntriesForBook } from "../src/lib/diary-entry-visibility.js";

const viewerId = "owner";
const friendId = "friend";
const outsiderId = "outsider";
const bookId = "book-seungseung";

const memberships = [
  { book_id: bookId, user_id: viewerId },
  { book_id: bookId, user_id: friendId },
  { book_id: "other-book", user_id: outsiderId },
];

const entries = [
  { id: "viewer-private", user_id: viewerId, book_id: null },
  { id: "friend-private", user_id: friendId, book_id: null },
  { id: "friend-book", user_id: friendId, book_id: bookId },
  { id: "outsider-private", user_id: outsiderId, book_id: null },
  { id: "outsider-book", user_id: outsiderId, book_id: "other-book" },
];

test("private diary view still shows only the viewer's own private entries", () => {
  assert.deepEqual(
    getVisibleDiaryEntriesForBook(entries, memberships, viewerId, "").map((entry) => entry.id),
    ["viewer-private"],
  );
});

test("shared diary view includes each member's private diary and explicit group entries", () => {
  assert.deepEqual(
    getVisibleDiaryEntriesForBook(entries, memberships, viewerId, bookId).map((entry) => entry.id),
    ["viewer-private", "friend-private", "friend-book"],
  );
});

test("shared diary view rejects users who are not members of that book", () => {
  assert.deepEqual(
    getVisibleDiaryEntriesForBook(entries, memberships, outsiderId, bookId),
    [],
  );
});
