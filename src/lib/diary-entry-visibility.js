export function getVisibleDiaryEntriesForBook(entries, memberships, viewerId, bookId) {
  if (!viewerId) return [];

  if (!bookId) {
    return entries.filter((entry) => entry.user_id === viewerId && !entry.book_id);
  }

  const viewerIsMember = memberships.some(
    (membership) => membership.book_id === bookId && membership.user_id === viewerId,
  );
  if (!viewerIsMember) return [];

  const memberIds = new Set(
    memberships
      .filter((membership) => membership.book_id === bookId)
      .map((membership) => membership.user_id),
  );

  return entries.filter((entry) => (
    entry.book_id === bookId
    || (!entry.book_id && memberIds.has(entry.user_id))
  ));
}
