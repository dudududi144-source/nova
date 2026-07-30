// Shared design tokens — single source of truth for all hardcoded colors

export const C = {
  cyan:    '#06b6d4',
  green:   '#10b981',
  amber:   '#f59e0b',
  red:     '#ef4444',
  purple:  '#8b5cf6',
  blue:    '#3b82f6',
  slate:   '#64748b',
  bg:      '#080c14',
  card:    '#111827',
  border:  '#1e293b',
  fg:      '#e2e8f0',
  muted:   '#64748b',
} as const;

// State → color mapping used by badges, timeline, cards
const STATE_COLORS: Record<string, string> = {
  uploaded: C.slate,
  extracting: C.cyan,
  analyzing: C.cyan,
  architecture_generated: C.cyan,
  plan_generated: C.purple,
  awaiting_approval: C.amber,
  approved: C.green,
  executing_agents: C.cyan,
  qa_running: C.cyan,
  security_scanning: C.blue,
  packaging: C.cyan,
  ready_for_download: C.green,
  completed: C.green,
  failed: C.red,
  rejected: C.red,
};

export function stateColor(state: string): string {
  return STATE_COLORS[state] ?? C.slate;
}

// Agent tier → color
export const TIER_COLORS: Record<string, string> = {
  executive:   C.purple,
  engineering: C.cyan,
  quality:     C.green,
  release:     C.amber,
};
