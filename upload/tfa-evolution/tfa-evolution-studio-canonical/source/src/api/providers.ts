import { apiFetch } from '@/lib/api-client';
import type { Provider } from './types';

export const providersApi = {
  list: () => apiFetch<Provider[]>('/providers'),
  ping: (id: number) =>
    apiFetch<{ healthy: boolean; latencyMs: number }>(`/providers/${id}/ping`, {
      method: 'POST',
    }),
  setDefault: (id: number) =>
    apiFetch(`/providers/${id}/set-default`, { method: 'POST' }),
};
