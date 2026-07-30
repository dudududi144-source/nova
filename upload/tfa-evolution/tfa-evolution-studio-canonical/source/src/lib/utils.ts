import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Time ─────────────────────────────────────────────────────────────────────
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Bytes ────────────────────────────────────────────────────────────────────
export function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

// ─── Duration ─────────────────────────────────────────────────────────────────
export function formatMs(ms: number | null): string {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

// ─── Uptime ───────────────────────────────────────────────────────────────────
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

// ─── Workflow stage helpers ───────────────────────────────────────────────────
const STAGE_LABEL_MAP: Record<string, string> = {
  extracting: 'Extracting files',
  analyzing: 'Analyzing codebase',
  architecture_generated: 'Architecture mapped',
  plan_generated: 'Plan ready',
  approved: 'Starting agents',
  executing_agents: 'Agents executing',
  qa_running: 'Running QA checks',
  security_scanning: 'Security scan',
  packaging: 'Packaging output',
};
export function stageLabel(state: string): string {
  return STAGE_LABEL_MAP[state] ?? state;
}

const STAGE_PROGRESS_MAP: Record<string, number> = {
  extracting: 10, analyzing: 20, architecture_generated: 30,
  plan_generated: 40, approved: 50, executing_agents: 65,
  qa_running: 80, security_scanning: 90, packaging: 95,
};
export function stageProgress(state: string): number {
  return STAGE_PROGRESS_MAP[state] ?? 5;
}

export const ACTIVE_STATES = [
  'extracting', 'analyzing', 'architecture_generated', 'plan_generated',
  'approved', 'executing_agents', 'qa_running', 'security_scanning', 'packaging',
];
