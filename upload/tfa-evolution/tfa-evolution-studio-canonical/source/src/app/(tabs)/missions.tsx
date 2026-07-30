import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  AlertTriangle, Zap, CheckCircle2, XCircle, Download,
  ChevronRight, Crosshair, Plus, Heart,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { workflowsApi } from '@/api/workflows';
import { artifactsApi } from '@/api/artifacts';
import { healthApi } from '@/api/health';
import { StateBadge } from '@/components/StateBadge';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Workflow, Artifact, HealthData } from '@/api/types';
import { getApiUrl } from '@/lib/api-client';
import { timeAgo, formatBytes, stageLabel, stageProgress, ACTIVE_STATES } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

// ─── Health bar at top ────────────────────────────────────────────────────────
function SystemHealthBar({ health }: { health: HealthData | null }) {
  if (!health) return null;
  const color = health.status === 'ok' ? C.green : health.status === 'degraded' ? C.amber : C.red;
  const label = health.status === 'ok' ? 'All Systems Operational' : health.status === 'degraded' ? 'Degraded Performance' : 'System Issues';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color + '10', borderBottomWidth: 1, borderBottomColor: color + '30', paddingHorizontal: 16, paddingVertical: 7 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', flex: 1 }}>{label}</Text>
      <Text style={{ color: color + 'AA', fontSize: 9, fontFamily: 'monospace' }}>v{health.version}</Text>
    </View>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, count, color = C.muted }: { label: string; count?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 }}>
      <View style={{ width: 2, height: 12, backgroundColor: color, borderRadius: 1 }} />
      <Text style={{ color, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1.5, flex: 1 }}>
        {label.toUpperCase()}
      </Text>
      {count !== undefined && (
        <View style={{ backgroundColor: color + '22', borderColor: color + '44', borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ color, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>{count}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Approval Card ────────────────────────────────────────────────────────────
function ApprovalCard({ workflow, onApprove, onReject, onTap, approving }: {
  workflow: Workflow; onApprove: () => void; onReject: () => void;
  onTap: () => void; approving: boolean;
}) {
  return (
    <Pressable onPress={onTap} className="active:opacity-80" style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={{ backgroundColor: C.card, borderColor: C.amber + '50', borderWidth: 1, borderRadius: 12 }}>
        <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.amber + '20' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={13} color={C.amber} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', marginBottom: 2 }} numberOfLines={1}>
                {workflow.projectName ?? `Project #${workflow.projectId}`}
              </Text>
              <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>
                {workflow.userObjective ?? 'Evolution plan ready for review'}
              </Text>
            </View>
            <ChevronRight size={14} color={C.muted} />
          </View>
          {workflow.plan?.objectives?.[0] && (
            <View style={{ backgroundColor: C.amber + '08', borderRadius: 6, padding: 8 }}>
              <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', marginBottom: 2 }}>FIRST OBJECTIVE</Text>
              <Text style={{ color: C.fg, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>
                {workflow.plan.objectives[0]}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>#{workflow.id}</Text>
            <Text style={{ color: C.border, fontSize: 9 }}>·</Text>
            <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>{timeAgo(workflow.updatedAt)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', padding: 10, gap: 8 }}>
          <Pressable
            onPress={onApprove} disabled={approving}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.green + '18', borderColor: C.green + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 10 }}
            className="active:opacity-70"
          >
            {approving ? <ActivityIndicator size="small" color={C.green} /> : <CheckCircle2 size={14} color={C.green} />}
            <Text style={{ color: C.green, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>APPROVE</Text>
          </Pressable>
          <Pressable
            onPress={onReject} disabled={approving}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.red + '18', borderColor: C.red + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 10 }}
            className="active:opacity-70"
          >
            <XCircle size={14} color={C.red} />
            <Text style={{ color: C.red, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>REJECT</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Active Workflow Card ─────────────────────────────────────────────────────
function ActiveCard({ workflow, onTap }: { workflow: Workflow; onTap: () => void }) {
  const pct = stageProgress(workflow.state);
  return (
    <Pressable onPress={onTap} className="active:opacity-80" style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', marginBottom: 2 }} numberOfLines={1}>
              {workflow.projectName ?? `Project #${workflow.projectId}`}
            </Text>
            <Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>
              {workflow.userObjective ?? 'Evolution in progress'}
            </Text>
          </View>
          <StateBadge state={workflow.state} />
        </View>
        {/* Progress bar */}
        <View style={{ height: 3, backgroundColor: '#1e293b', borderRadius: 2, marginBottom: 8 }}>
          <View style={{ height: 3, width: `${pct}%` as any, backgroundColor: C.cyan, borderRadius: 2 }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>
            {stageLabel(workflow.state)}
          </Text>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>
            {pct}% · {timeAgo(workflow.updatedAt)}
          </Text>
        </View>
        {workflow.agents && workflow.agents.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
            {workflow.agents.slice(0, 4).map(a => (
              <View key={a.id} style={{
                backgroundColor: a.status === 'completed' ? C.green + '18' : a.status === 'running' ? C.cyan + '18' : a.status === 'failed' ? C.red + '18' : '#1e293b',
                borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
              }}>
                <Text style={{
                  fontSize: 9, fontFamily: 'monospace', fontWeight: '700',
                  color: a.status === 'completed' ? C.green : a.status === 'running' ? C.cyan : a.status === 'failed' ? C.red : C.muted,
                }}>
                  {a.agentName ?? a.agentId}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ─── Completed Card ───────────────────────────────────────────────────────────
function CompletedCard({ workflow, artifact, onDownload, onTap }: {
  workflow: Workflow; artifact: Artifact | null;
  onDownload: () => void; onTap: () => void;
}) {
  return (
    <Pressable onPress={onTap} className="active:opacity-80" style={{ marginHorizontal: 16, marginBottom: 8 }}>
      <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: C.green + '15', alignItems: 'center', justifyContent: 'center' }}>
          <CheckCircle2 size={16} color={C.green} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
            {workflow.projectName ?? `Project #${workflow.projectId}`}
          </Text>
          <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>
            {artifact ? formatBytes(artifact.fileSize) : 'completed'} · {timeAgo(workflow.updatedAt)}
          </Text>
        </View>
        {artifact && (
          <Pressable
            onPress={onDownload}
            style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.green + '18', borderColor: C.green + '40', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}
            className="active:opacity-70"
          >
            <Download size={14} color={C.green} />
          </Pressable>
        )}
        <ChevronRight size={14} color={C.muted} />
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MissionsScreen() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [artifactMap, setArtifactMap] = useState<Map<number, Artifact>>(new Map());
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [wfs, arts, h] = await Promise.allSettled([
        workflowsApi.list(),
        artifactsApi.list(),
        healthApi.get(),
      ]);
      if (wfs.status === 'fulfilled') setWorkflows(wfs.value);
      if (arts.status === 'fulfilled') {
        const m = new Map<number, Artifact>();
        for (const a of arts.value) {
          if (a.workflowId) m.set(a.workflowId, a);
        }
        setArtifactMap(m);
      }
      if (h.status === 'fulfilled') setHealth(h.value);
      if (wfs.status === 'rejected') setError((wfs.reason as any)?.message ?? 'Failed to load');
      else setError(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]));

  const handleApprove = useCallback(async (id: number) => {
    setApprovingId(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try { await workflowsApi.approve(id); await load(); }
    catch { /* */ } finally { setApprovingId(null); }
  }, [load]);

  const handleReject = useCallback(async (id: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try { await workflowsApi.reject(id, 'Rejected by user'); await load(); } catch { /* */ }
  }, [load]);

  const handleDownload = useCallback(async (workflowId: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const artifact = artifactMap.get(workflowId);
    if (!artifact) return;
    const base = await getApiUrl();
    await WebBrowser.openBrowserAsync(`${base}/api/artifacts/${artifact.id}/download`);
  }, [artifactMap]);

  const approvalQueue = workflows.filter(w => w.state === 'awaiting_approval');
  const activeList = workflows.filter(w => ACTIVE_STATES.includes(w.state));
  const completedList = workflows.filter(w => w.state === 'completed' || w.state === 'ready_for_download')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);
  const isEmpty = workflows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Crosshair size={18} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 18, fontFamily: 'monospace', fontWeight: '700' }}>MISSIONS</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {approvalQueue.length > 0 && (
              <View style={{ backgroundColor: C.amber, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: C.bg, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>{approvalQueue.length}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <SystemHealthBar health={health} />
      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && isEmpty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color={C.cyan} size="large" />
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>LOADING MISSIONS...</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
          showsVerticalScrollIndicator={false}
        >
          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.cyan + '15', borderColor: C.cyan + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Crosshair size={28} color={C.cyan} />
              </View>
              <Text style={{ color: C.fg, fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: 'monospace' }}>SYSTEM IDLE</Text>
              <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 24 }}>
                No active missions. Go to Forge to pick a project and launch an evolution.
              </Text>
              <Pressable
                onPress={() => router.push('/launch' as RelativePathString)}
                style={{ backgroundColor: C.cyan, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                className="active:opacity-80"
              >
                <Plus size={16} color={C.bg} />
                <Text style={{ color: C.bg, fontSize: 13, fontFamily: 'monospace', fontWeight: '700' }}>LAUNCH FIRST MISSION</Text>
              </Pressable>
            </View>
          ) : null}

          {approvalQueue.length > 0 && (
            <>
              <SectionHeader label="Needs Your Decision" count={approvalQueue.length} color={C.amber} />
              {approvalQueue.map(w => (
                <ApprovalCard
                  key={w.id} workflow={w}
                  approving={approvingId === w.id}
                  onApprove={() => handleApprove(w.id)}
                  onReject={() => handleReject(w.id)}
                  onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)}
                />
              ))}
            </>
          )}

          {activeList.length > 0 && (
            <>
              <SectionHeader label="Active Evolutions" count={activeList.length} color={C.cyan} />
              {activeList.map(w => (
                <ActiveCard key={w.id} workflow={w} onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)} />
              ))}
            </>
          )}

          {completedList.length > 0 && (
            <>
              <SectionHeader label="Recently Completed" count={completedList.length} color={C.green} />
              {completedList.map(w => (
                <CompletedCard
                  key={w.id} workflow={w}
                  artifact={artifactMap.get(w.id) ?? null}
                  onDownload={() => handleDownload(w.id)}
                  onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* FAB */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/launch' as RelativePathString); }}
        style={{
          position: 'absolute', bottom: 24, right: 20,
          width: 54, height: 54, borderRadius: 27, backgroundColor: C.cyan,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
        }}
        className="active:opacity-80"
      >
        <Zap size={22} color={C.bg} />
      </Pressable>
    </View>
  );
}
