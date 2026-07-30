import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, FlatList,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Search, X, FolderOpen, GitBranch, Archive, ChevronRight } from 'lucide-react-native';
import { workflowsApi } from '@/api/workflows';
import { projectsApi } from '@/api/projects';
import { artifactsApi } from '@/api/artifacts';
import { StateBadge } from '@/components/StateBadge';
import type { Workflow, Project, Artifact } from '@/api/types';
import { timeAgo, formatBytes } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

interface SearchResults {
  projects: Project[];
  workflows: Workflow[];
  artifacts: Artifact[];
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
      {icon}
      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, flex: 1 }}>{label}</Text>
      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{count}</Text>
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [allData, setAllData] = useState<SearchResults>({ projects: [], workflows: [], artifacts: [] });
  const [loaded, setLoaded] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [projects, workflows, artifacts] = await Promise.allSettled([
        projectsApi.list(),
        workflowsApi.list(),
        artifactsApi.list(),
      ]);
      setAllData({
        projects: projects.status === 'fulfilled' ? projects.value : [],
        workflows: workflows.status === 'fulfilled' ? workflows.value : [],
        artifacts: artifacts.status === 'fulfilled' ? artifacts.value : [],
      });
      setLoaded(true);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadAll();
    setTimeout(() => inputRef.current?.focus(), 300);
  }, [loadAll]);

  const q = query.toLowerCase().trim();
  const filtered: SearchResults = q === '' ? { projects: [], workflows: [], artifacts: [] } : {
    projects: allData.projects.filter(p => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)),
    workflows: allData.workflows.filter(w =>
      w.userObjective?.toLowerCase().includes(q) ||
      w.projectName?.toLowerCase().includes(q) ||
      w.state.includes(q) ||
      String(w.id).includes(q)
    ),
    artifacts: allData.artifacts.filter(a => a.filename.toLowerCase().includes(q)),
  };

  const totalResults = filtered.projects.length + filtered.workflows.length + filtered.artifacts.length;
  const hasQuery = q.length > 0;
  const hasResults = totalResults > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1,
            borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
          }}>
            <Search size={16} color={C.muted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search projects, workflows, artifacts..."
              placeholderTextColor={C.muted}
              style={{ flex: 1, color: C.fg, fontSize: 14 }}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} className="active:opacity-70">
                <X size={14} color={C.muted} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => router.back()} className="active:opacity-70">
            <Text style={{ color: C.cyan, fontSize: 13, fontFamily: 'monospace' }}>Cancel</Text>
          </Pressable>
        </View>

        {loading && !loaded && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <ActivityIndicator size="small" color={C.cyan} />
            <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>Loading index...</Text>
          </View>
        )}
        {loaded && hasQuery && (
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 8 }}>
            {hasResults ? `${totalResults} result${totalResults !== 1 ? 's' : ''}` : 'No results'}
          </Text>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} keyboardDismissMode="on-drag">
        {/* Empty / Idle state */}
        {!hasQuery && (
          <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 10 }}>
            <Search size={36} color={C.border} />
            <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              Search across all {allData.projects.length} projects, {allData.workflows.length} workflows, and {allData.artifacts.length} artifacts
            </Text>
          </View>
        )}

        {hasQuery && !hasResults && loaded && (
          <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 10 }}>
            <Search size={36} color={C.border} />
            <Text style={{ color: C.fg, fontSize: 15, fontWeight: '600' }}>No results for "{query}"</Text>
            <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>Try a different search term</Text>
          </View>
        )}

        {/* Projects */}
        {filtered.projects.length > 0 && (
          <>
            <SectionHeader icon={<FolderOpen size={12} color={C.muted} />} label="PROJECTS" count={filtered.projects.length} />
            {filtered.projects.map(p => (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/projects/${p.id}` as RelativePathString)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a', gap: 12 }}
                className="active:bg-secondary"
              >
                <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.cyan + '15', alignItems: 'center', justifyContent: 'center' }}>
                  <FolderOpen size={16} color={C.cyan} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                  {p.description && <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>{p.description}</Text>}
                </View>
                <ChevronRight size={14} color={C.muted} />
              </Pressable>
            ))}
          </>
        )}

        {/* Workflows */}
        {filtered.workflows.length > 0 && (
          <>
            <SectionHeader icon={<GitBranch size={12} color={C.muted} />} label="WORKFLOWS" count={filtered.workflows.length} />
            {filtered.workflows.map(w => (
              <Pressable
                key={w.id}
                onPress={() => router.push(`/workflows/${w.id}` as RelativePathString)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a', gap: 12 }}
                className="active:bg-secondary"
              >
                <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.purple + '15', alignItems: 'center', justifyContent: 'center' }}>
                  <GitBranch size={16} color={C.purple} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                    {w.projectName ?? `Workflow #${w.id}`}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>
                    {w.userObjective ?? '—'} · {timeAgo(w.updatedAt)}
                  </Text>
                </View>
                <StateBadge state={w.state} />
              </Pressable>
            ))}
          </>
        )}

        {/* Artifacts */}
        {filtered.artifacts.length > 0 && (
          <>
            <SectionHeader icon={<Archive size={12} color={C.muted} />} label="ARTIFACTS" count={filtered.artifacts.length} />
            {filtered.artifacts.map(a => (
              <View
                key={a.id}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a', gap: 12 }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.green + '15', alignItems: 'center', justifyContent: 'center' }}>
                  <Archive size={16} color={C.green} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{a.filename}</Text>
                  <Text style={{ color: C.muted, fontSize: 11 }}>{formatBytes(a.fileSize)} · {timeAgo(a.createdAt)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
