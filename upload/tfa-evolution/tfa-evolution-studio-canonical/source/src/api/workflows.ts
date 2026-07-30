import { apiFetch } from '@/lib/api-client';
import type { Workflow } from './types';

export const workflowsApi = {
  list: () => apiFetch<Workflow[]>('/workflows'),
  get: (id: number) => apiFetch<Workflow>(`/workflows/${id}`),
  create: (projectId: number, versionId: number, objective: string) =>
    apiFetch<Workflow>('/workflows', {
      method: 'POST',
      body: JSON.stringify({ projectId, versionId, objective }),
    }),
  approve: (id: number, notes?: string) =>
    apiFetch<Workflow>(`/workflows/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  reject: (id: number, reason?: string) =>
    apiFetch<Workflow>(`/workflows/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
