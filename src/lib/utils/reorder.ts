/** Move to the target's original position, including the final position. */
export function moveToPosition(ids: readonly string[], fromId: string, targetId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(targetId);
  const next = [...ids];
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}
