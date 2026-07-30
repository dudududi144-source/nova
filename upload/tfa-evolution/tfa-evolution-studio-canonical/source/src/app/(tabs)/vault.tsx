import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Archive, Brain, Settings, Download, Search, Clock, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { artifactsApi } from '@/api/artifacts';
import { auditApi } from '@/api/audit';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Artifact, AuditEntry } from '@/api/types';
import { getApiUrl } from '@/lib/api-client';
import { formatBytes, timeAgo } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

type VaultTab = 'outputs' | 'memory';

// ─── Action colors by type ─────────────────────────────────────────────────────
const ACTION_COLOR: Record<string, string> = {
  workflow_created: C.cyan, workflow_approved: C.green, workflow_rejected: C.red,
  workflow_completed: C.green, workflow_failed: C.red,
  project_created: C.purple, version_uploaded: C.blue,
  settings_updated: C.amber, audit: C.muted,
};
function actionColor(action: string) {
  for (const [k, v] of Object.entries(ACTION_COLOR)) {
    if (action.toLowerCase().includes(k)) return v;
  }
  return C.muted;
}

// ─── Outputs Tab ──────────────────────────────────────────────────────────────
function OutputsTab() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await artifactsApi.list();
      setArtifacts(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch { /* */ } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDownload = useCallback(async (artifact: Artifact) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const base = await getApiUrl();
    await WebBrowser.openBrowserAsync(`${base}/api/artifacts/${artifact.id}/download`);
  }, []);

  const filtered = artifacts.filter(a =>
    !search || a.filename.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.cyan} />
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
    >
      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Search size={14} color={C.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search artifacts..." placeholderTextColor={C.muted} style={{ flex: 1, color: C.fg, fontSize: 13 }} />
        </View>
      </View>

      {filtered.length === 0 ? (
        <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
          <Archive size={36} color={C.border} style={{ marginBottom: 12 }} />
          <Text style={{ color: C.fg, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
            {search ? 'No matching artifacts' : 'No outputs yet'}
          </Text>
          <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>
            {search ? 'Try a different search term' : 'Completed evolutions appear here as downloadable artifacts.'}
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
          {filtered.map(a => (
            <View key={a.id} style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: C.green + '15', alignItems: 'center', justifyContent: 'center' }}>
                <Archive size={18} color={C.green} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', marginBottom: 2 }} numberOfLines={1}>{a.filename}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{formatBytes(a.fileSize)}</Text>
                  <Text style={{ color: C.border }}>·</Text>
                  <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(a.createdAt)}</Text>
                  {a.workflowId && (
                    <>
                      <Text style={{ color: C.border }}>·</Text>
                      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>wf#{a.workflowId}</Text>
                    </>
                  )}
                </View>
              </View>
              <Pressable
                onPress={() => handleDownload(a)}
                style={{ width: 38, height: 38, borderRadius: 9, backgroundColor: C.green + '18', borderColor: C.green + '40', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}
                className="active:opacity-70"
              >
                <Download size={16} color={C.green} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── Memory (Audit Timeline) Tab ──────────────────────────────────────────────
function MemoryTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await auditApi.list();
      setEntries(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch { /* */ } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.cyan} />
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
    >
      {entries.length === 0 ? (
        <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
          <Brain size={36} color={C.border} style={{ marginBottom: 12 }} />
          <Text style={{ color: C.fg, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>No activity yet</Text>
          <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>System events and actions are recorded here as a timeline.</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          {entries.map((e, idx) => {
            const color = actionColor(e.action);
            return (
              <View key={e.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 0 }}>
                {/* Timeline spine */}
                <View style={{ alignItems: 'center', width: 20 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 14, zIndex: 1 }} />
                  {idx < entries.length - 1 && (
                    <View style={{ width: 1, flex: 1, backgroundColor: '#1e293b', minHeight: 20 }} />
                  )}
                </View>
                {/* Content */}
                <View style={{ flex: 1, paddingBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: C.fg, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {e.action.replace(/_/g, ' ')}
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{timeAgo(e.createdAt)}</Text>
                  </View>
                  {(e.resourceType || e.resourceId) && (
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
                      {e.resourceType && (
                        <View style={{ backgroundColor: color + '15', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ color, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>
                            {e.resourceType}{e.resourceId ? ` #${e.resourceId}` : ''}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                  {e.details && (
                    <Text style={{ color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 4 }} numberOfLines={2}>{e.details}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function VaultScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<VaultTab>('outputs');

  const TABS: { id: VaultTab; label: string; icon: React.ReactNode }[] = [
    { id: 'outputs', label: 'OUTPUTS', icon: <Archive size={13} color={activeTab === 'outputs' ? C.cyan : C.muted} /> },
    { id: 'memory', label: 'MEMORY', icon: <Brain size={13} color={activeTab === 'memory' ? C.cyan : C.muted} /> },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 0, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Archive size={18} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 18, fontFamily: 'monospace', fontWeight: '700' }}>VAULT</Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings' as RelativePathString)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1, borderRadius: 8 }}
            className="active:opacity-70"
          >
            <Settings size={13} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>Settings</Text>
          </Pressable>
        </View>

        {/* Tab bar */}
        <View style={{ flexDirection: 'row' }}>
          {TABS.map(tab => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 10,
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab.id ? C.cyan : 'transparent',
              }}
              className="active:opacity-70"
            >
              {tab.icon}
              <Text style={{ color: activeTab === tab.id ? C.cyan : C.muted, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === 'outputs' && <OutputsTab />}
      {activeTab === 'memory' && <MemoryTab />}
    </View>
  );
}
