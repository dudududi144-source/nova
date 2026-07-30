import { apiFetch } from '@/lib/api-client';
import type { AgentObservatoryData } from './types';

export const agentsApi = {
  observatory: () => apiFetch<AgentObservatoryData>('/agents/observatory'),
  workflowAgents: (workflowId: number) =>
    apiFetch<any>(`/agents/observatory/workflows/${workflowId}`),
};
