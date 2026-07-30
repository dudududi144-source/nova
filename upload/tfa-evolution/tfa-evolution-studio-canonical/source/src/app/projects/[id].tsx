import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, GitFork, Upload, FolderOpen, GitBranch, Layers, ChevronRight, Clock } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { projectsApi } from '@/api/projects';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Project, ProjectVersion } from '@/api/types';
import { formatBytes, timeAgo } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, v] = await Promise.all([projectsApi.get(projectId), projectsApi.versions(projectId)]);
      setProject(p);
      setVersions(v.sort((a, b) => b.versionNumber - a.versionNumber));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load project');
    } finally { setLoading(false); setRefreshing(false); }
  }, [projectId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleUpload = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const v = await projectsApi.upload(projectId, asset.uri, asset.name);
      setVersions(prev => [v, ...prev]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message ?? 'Upload failed');
    } finally { setUploading(false); }
  }, [projectId]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: C.fg, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
              {project?.name ?? `Project #${id}`}
            </Text>
            {project?.description && (
              <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{project.description}</Text>
            )}
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !project ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          {/* Stats row */}
          {project && (
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
              <View style={{ flex: 1, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: C.fg, fontSize: 20, fontFamily: 'monospace', fontWeight: '700' }}>{versions.length}</Text>
                <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>VERSIONS</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} color={C.muted} />
                  <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>{timeAgo(project.updatedAt)}</Text>
                </View>
                <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>LAST UPDATED</Text>
              </View>
            </View>
          )}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16 }}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push({ pathname: '/launch' as RelativePathString, params: { projectId: String(projectId) } }); }}
              style={{ flex: 1, backgroundColor: C.cyan, borderRadius: 10, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              className="active:opacity-80"
            >
              <GitFork size={14} color={C.bg} />
              <Text style={{ color: C.bg, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>LAUNCH EVOLUTION</Text>
            </Pressable>
            <Pressable
              onPress={handleUpload}
              style={{ flex: 1, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              className="active:opacity-80"
            >
              {uploading ? <ActivityIndicator size="small" color={C.cyan} /> : <><Upload size={14} color={C.cyan} /><Text style={{ color: C.cyan, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>UPLOAD ZIP</Text></>}
            </Pressable>
          </View>

          {/* Quick links */}
          <View style={{ backgroundColor: C.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border, marginBottom: 16 }}>
            {[
              { label: 'File Explorer', icon: <FolderOpen size={14} color={C.muted} />, route: `/projects/explorer?id=${projectId}` },
              { label: 'Version Lineage', icon: <GitBranch size={14} color={C.muted} />, route: `/projects/lineage?id=${projectId}` },
            ].map((item, i) => (
              <Pressable
                key={item.label}
                onPress={() => router.push(item.route as RelativePathString)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i === 0 ? 1 : 0, borderBottomColor: '#0f172a', gap: 10 }}
                className="active:bg-secondary"
              >
                {item.icon}
                <Text style={{ color: C.fg, fontSize: 13, flex: 1 }}>{item.label}</Text>
                <ChevronRight size={14} color={C.muted} />
              </Pressable>
            ))}
          </View>

          {/* Versions list */}
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <View style={{ width: 2, height: 10, backgroundColor: C.cyan, borderRadius: 1 }} />
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1.5 }}>
                VERSIONS ({versions.length})
              </Text>
            </View>

            {versions.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 32, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12 }}>
                <Layers size={28} color={C.border} style={{ marginBottom: 8 }} />
                <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>No versions yet. Upload a ZIP to start.</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
                {versions.map((v, i) => (
                  <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i < versions.length - 1 ? 1 : 0, borderBottomColor: '#0a0f18', gap: 10 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.cyan + '18', borderColor: C.cyan + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>v{v.versionNumber}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: C.fg, fontSize: 12 }} numberOfLines={1}>{v.filename}</Text>
                      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{formatBytes(v.fileSize)} · {timeAgo(v.createdAt)}</Text>
                    </View>
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/launch' as RelativePathString, params: { projectId: String(projectId) } }); }}
                      style={{ backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}
                      className="active:opacity-70"
                    >
                      <Text style={{ color: C.cyan, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>EVOLVE</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
