import { apiFetch } from '@/lib/api-client';
import type { AppSettings } from './types';

export const settingsApi = {
  get: () => apiFetch<AppSettings>('/settings'),
  update: (data: Partial<AppSettings>) =>
    apiFetch<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
