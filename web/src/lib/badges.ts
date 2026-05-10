export function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    running: 'bg-blue-50 text-blue-600 dark:bg-blue-900 dark:text-blue-300',
    complete: 'bg-green-50 text-green-600 dark:bg-green-900 dark:text-green-300',
    failed: 'bg-red-50 text-red-600 dark:bg-red-900 dark:text-red-300',
    interrupted: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400',
    pending: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400',
    approved: 'bg-green-50 text-green-600 dark:bg-green-900 dark:text-green-300',
    rejected: 'bg-red-50 text-red-600 dark:bg-red-900 dark:text-red-300',
    timed_out: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400',
    revision_requested: 'bg-blue-50 text-blue-600 dark:bg-blue-900 dark:text-blue-300',
    needs_review: 'bg-amber-50 text-amber-600 dark:bg-amber-900 dark:text-amber-300',
    blocked: 'bg-purple-50 text-purple-600 dark:bg-purple-900 dark:text-purple-300',
    skipped: 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400',
  };
  return map[status] || 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400';
}
