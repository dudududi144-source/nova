import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_URL = 'http://localhost:4000';
const API_URL_KEY = 'tfa_api_url';

export async function getApiUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(API_URL_KEY);
    return stored ? stored.replace(/\/$/, '') : DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

export async function saveApiUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_URL_KEY, url.replace(/\/$/, ''));
}

/** @deprecated use getApiUrl() async */
export function loadApiUrl(): Promise<void> { return Promise.resolve(); }

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base = await getApiUrl();
  const url = `${base}${path}`;

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers) },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return res.text() as unknown as T;
}
