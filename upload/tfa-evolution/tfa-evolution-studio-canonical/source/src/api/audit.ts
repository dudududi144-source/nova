import { apiFetch } from '@/lib/api-client';
import type { AuditEntry } from './types';

export const auditApi = {
  /** Returns array of audit entries (unwraps envelope if needed) */
  list: async (page = 1, limit = 50): Promise<AuditEntry[]> => {
    const result = await apiFetch<AuditEntry[] | { entries: AuditEntry[]; total: number }>(
      `/audit?page=${page}&limit=${limit}`,
    );
    if (Array.isArray(result)) return result;
    return result.entries ?? [];
  },
};
