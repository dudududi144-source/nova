import { apiFetch } from '@/lib/api-client';
import type { HealthData } from './types';

export const healthApi = {
  check: () => apiFetch<HealthData>('/health'),
  /** @deprecated use check() */
  get: () => apiFetch<HealthData>('/health'),
  providerDiagnostics: () => apiFetch<any>('/providers/diagnostics'),
  history: () => apiFetch<any>('/admin/health/history'),
};
