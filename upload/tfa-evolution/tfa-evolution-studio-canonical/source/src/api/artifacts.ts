import { apiFetch } from '@/lib/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Artifact } from './types';

const API_URL_KEY = 'tfa_api_url';
const DEFAULT_API_URL = 'http://localhost:4000/api';

export const artifactsApi = {
  list: () => apiFetch<Artifact[]>('/artifacts'),
  get: (id: number) => apiFetch<Artifact>(`/artifacts/${id}`),
  downloadUrl: async (id: number): Promise<string> => {
    const stored = await AsyncStorage.getItem(API_URL_KEY);
    const base = stored ? stored.replace(/\/$/, '') : DEFAULT_API_URL;
    return `${base}/artifacts/${id}/download`;
  },
};
