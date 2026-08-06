const adminIds = new Set(
  (import.meta.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter(Boolean)
);

export function isAdmin(userId: string): boolean {
  return adminIds.has(userId);
}
