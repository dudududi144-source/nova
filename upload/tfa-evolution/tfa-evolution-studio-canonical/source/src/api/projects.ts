import { apiFetch, getApiUrl } from '@/lib/api-client';
import type { Project, ProjectVersion } from './types';

export const projectsApi = {
  list: () => apiFetch<Project[]>('/projects'),
  get: (id: number) => apiFetch<Project>(`/projects/${id}`),
  create: (name: string, description?: string) =>
    apiFetch<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  versions: (id: number) =>
    apiFetch<ProjectVersion[]>(`/projects/${id}/versions`),

  /** Upload a ZIP file and create a new version. Returns the new ProjectVersion. */
  upload: async (
    projectId: number,
    fileUri: string,
    fileName: string,
  ): Promise<ProjectVersion> => {
    const base = await getApiUrl();
    const formData = new FormData();
    formData.append('file', { uri: fileUri, name: fileName, type: 'application/zip' } as any);
    const res = await fetch(`${base}/projects/${projectId}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload failed: ${text || res.statusText}`);
    }
    return res.json();
  },

  files: (id: number, versionId?: number) => {
    const q = versionId ? `?versionId=${versionId}` : '';
    return apiFetch<{ path: string; type: 'file' | 'dir'; size?: number }[]>(
      `/projects/${id}/files${q}`,
    );
  },
  lineage: (id: number) => apiFetch<any>(`/lineage/${id}`),
};
