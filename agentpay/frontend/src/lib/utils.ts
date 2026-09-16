export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export const formatPaise = formatRupees;

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    SUCCEEDED: 'badge-success', AUTHORIZED: 'badge-success', active: 'badge-success', approved: 'badge-success',
    DENIED: 'badge-danger', REJECTED: 'badge-danger', FAILED: 'badge-danger', revoked: 'badge-danger', failed: 'badge-danger',
    PENDING_APPROVAL: 'badge-warning', EXECUTING: 'badge-warning', pending: 'badge-warning', disabled: 'badge-warning', processing: 'badge-warning',
    CREATED: 'badge-neutral', EVALUATING: 'badge-neutral', EXPIRED: 'badge-neutral', expired: 'badge-neutral', succeeded: 'badge-success',
  };
  return map[status] || 'badge-neutral';
}
