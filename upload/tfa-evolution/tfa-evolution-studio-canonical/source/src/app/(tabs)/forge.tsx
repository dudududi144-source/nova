import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Hammer, Plus, FolderOpen, GitFork, ChevronRight, Clock, Layers, Search, GitBranch } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { projectsApi } from '@/api/projects';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Project } from '@/api/types';
import { timeAgo } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

function ProjectCard({ project, onTap, onLaunch }: { project: Project; onTap: () => void; onLaunch: () => void }) {
  const hasDescription = !!project.description;
  return (
    <Pressable onPress={onTap} className="active:opacity-90" style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: hasDescription ? 8 : 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: C.cyan + '18', borderColor: C.cyan + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <FolderOpen size={16} color={C.cyan} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: C.fg, fontSize: 14, fontWeight: '700', marginBottom: 2 }} numberOfLines={1}>{project.name}</Text>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>#{project.id}</Text>
            </View>
            <ChevronRight size={14} color={C.muted} />
          </View>

          {hasDescription && (
            <Text style={{ color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }} numberOfLines={2}>
              {project.description}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Layers size={11} color={C.slate} />
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>
                {project.versionCount ?? 0} version{(project.versionCount ?? 0) !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Clock size={11} color={C.slate} />
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(project.updatedAt)}</Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={onLaunch}
          style={{ backgroundColor: C.cyan + '08', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          className="active:opacity-70"
        >
          <GitFork size={12} color={C.cyan} />
          <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.5 }}>LAUNCH EVOLUTION</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function ForgeScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await projectsApi.list();
      setProjects(data.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load projects');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = projects.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Hammer size={18} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 18, fontFamily: 'monospace', fontWeight: '700' }}>FORGE</Text>
            {projects.length > 0 && (
              <View style={{ backgroundColor: C.cyan + '20', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ color: C.cyan, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>{projects.length}</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/projects/create' as RelativePathString); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.cyan + '18', borderColor: C.cyan + '40', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            className="active:opacity-70"
          >
            <Plus size={14} color={C.cyan} />
            <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>NEW</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Search size={14} color={C.muted} />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search projects..."
            placeholderTextColor={C.muted}
            style={{ flex: 1, color: C.fg, fontSize: 13 }}
          />
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !projects.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color={C.cyan} />
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>LOADING PROJECTS...</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.cyan + '12', borderColor: C.cyan + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Hammer size={28} color={C.cyan} />
              </View>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 8 }}>
                {search ? 'No matching projects' : 'No projects yet'}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 20 }}>
                {search ? 'Try a different search term' : 'Create your first project to start evolving code with AI.'}
              </Text>
              {!search && (
                <Pressable
                  onPress={() => router.push('/projects/create' as RelativePathString)}
                  style={{ backgroundColor: C.cyan, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  className="active:opacity-80"
                >
                  <Plus size={14} color={C.bg} />
                  <Text style={{ color: C.bg, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>CREATE FIRST PROJECT</Text>
                </Pressable>
              )}
            </View>
          ) : (
            filtered.map(p => (
              <ProjectCard
                key={p.id} project={p}
                onTap={() => router.push(`/projects/${p.id}` as RelativePathString)}
                onLaunch={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/launch' as RelativePathString, params: { projectId: String(p.id) } }); }}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
