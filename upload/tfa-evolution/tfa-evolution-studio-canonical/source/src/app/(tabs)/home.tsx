import {
  View, Text, ScrollView, Pressable, RefreshControl,
  ActivityIndicator, FlatList,
} from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Zap, AlertTriangle, CheckCircle2, Clock, Archive,
  ChevronRight, Activity, TrendingUp, Heart, Settings,
  Search,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { workflowsApi } from '@/api/workflows';
import { artifactsApi } from '@/api/artifacts';
import { healthApi } from '@/api/health';
import { StateBadge } from '@/components/StateBadge';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Workflow, Artifact, HealthData } from '@/api/types';
import { timeAgo, ACTIVE_STATES } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatusPill({ health }: { health: HealthData | null }) {
  if (!health) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.border + '80', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.slate }} />
        <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>OFFLINE</Text>
      </View>
    );
  }
  const color = health.status === 'ok' ? C.green : health.status === 'degraded' ? C.amber : C.red;
  const label = health.status === 'ok' ? 'ONLINE' : health.status.toUpperCase();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: color + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: React.ReactNode }) {
  return (
    <View style={{
      flex: 1, backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
      borderRadius: 12, padding: 14, gap: 8,
    }}
      // @ts-ignore borderCurve is valid on RN iOS
      // eslint-disable-next-line react-native/no-inline-styles
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {icon}
        <Text style={{ color, fontSize: 22, fontWeight: '700', fontFamily: 'monospace' }}>{value}</Text>
      </View>
      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
    </View>
  );
}

function ActiveWorkflowRow({ wf, onPress }: { wf: Workflow; onPress: () => void }) {
  const pct = wf.state === 'executing_agents' ? 65 :
    wf.state === 'packaging' ? 90 :
    wf.state === 'qa_running' ? 80 : 40;

  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
            <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', marginBottom: 2 }} numberOfLines={1}>
              {wf.projectName ?? `Project #${wf.projectId}`}
            </Text>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
              {wf.userObjective ?? 'Evolution mission'}
            </Text>
          </View>
          <StateBadge state={wf.state} />
        </View>
        <View style={{ height: 3, backgroundColor: '#1e293b', borderRadius: 2 }}>
          <View style={{ height: 3, width: `${pct}%` as any, backgroundColor: C.cyan, borderRadius: 2 }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>
            {pct}% complete
          </Text>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>
            {timeAgo(wf.updatedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function ApprovalRow({ wf, onApprove, onReject, onPress }: {
  wf: Workflow;
  onApprove: () => void;
  onReject: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <View style={{ backgroundColor: C.amber + '0A', borderColor: C.amber + '40', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <AlertTriangle size={12} color={C.amber} />
          <Text style={{ color: C.amber, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {wf.projectName ?? `Project #${wf.projectId}`} — AWAITING DECISION
          </Text>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>{timeAgo(wf.updatedAt)}</Text>
        </View>
        <Text style={{ color: C.fg, fontSize: 12, marginBottom: 10 }} numberOfLines={2}>
          {wf.userObjective ?? 'Evolution plan ready for review'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={onApprove}
            style={{ flex: 1, backgroundColor: C.green + '18', borderColor: C.green + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            className="active:opacity-70"
          >
            <Text style={{ color: C.green, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>APPROVE</Text>
          </Pressable>
          <Pressable
            onPress={onReject}
            style={{ flex: 1, backgroundColor: C.red + '18', borderColor: C.red + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            className="active:opacity-70"
          >
            <Text style={{ color: C.red, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>REJECT</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function RecentArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.green + '15', alignItems: 'center', justifyContent: 'center' }}>
        <CheckCircle2 size={14} color={C.green} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: C.fg, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{artifact.filename}</Text>
        <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(artifact.createdAt)}</Text>
      </View>
      <Archive size={12} color={C.muted} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [wfs, arts, h] = await Promise.allSettled([
        workflowsApi.list(),
        artifactsApi.list(),
        healthApi.get(),
      ]);
      if (wfs.status === 'fulfilled') setWorkflows(wfs.value);
      if (arts.status === 'fulfilled') setArtifacts(arts.value.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      if (h.status === 'fulfilled') setHealth(h.value);
      if (wfs.status === 'rejected' && arts.status === 'rejected') {
        setError('Cannot reach backend. Check API URL in Settings.');
      } else {
        setError(null);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const activeWorkflows = workflows.filter(w => ACTIVE_STATES.includes(w.state));
  const approvalQueue = workflows.filter(w => w.state === 'awaiting_approval');
  const completedCount = workflows.filter(w => w.state === 'completed' || w.state === 'ready_for_download').length;
  const recentArtifacts = artifacts.slice(0, 3);

  const handleApprove = useCallback(async (id: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await workflowsApi.approve(id);
      load();
    } catch { /* */ }
  }, [load]);

  const handleReject = useCallback(async (id: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await workflowsApi.reject(id, 'Rejected from dashboard');
      load();
    } catch { /* */ }
  }, [load]);

  const openWorkflow = useCallback((id: number) => {
    router.push(`/workflows/${id}` as RelativePathString);
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <View>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1.5, textTransform: 'uppercase' }}>TFA EVOLUTION STUDIO</Text>
            <Text style={{ color: C.fg, fontSize: 20, fontWeight: '700', fontFamily: 'monospace', marginTop: 2 }}>Command Center</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <StatusPill health={health} />
            <Pressable
              onPress={() => router.push('/search' as RelativePathString)}
              style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' }}
              className="active:opacity-70"
            >
              <Search size={16} color={C.muted} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings' as RelativePathString)}
              style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' }}
              className="active:opacity-70"
            >
              <Settings size={16} color={C.muted} />
            </Pressable>
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !workflows.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={C.cyan} size="large" />
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>CONNECTING TO BACKEND...</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.cyan} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Stats Row */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
            <StatCard
              label="Active"
              value={activeWorkflows.length}
              color={C.cyan}
              icon={<Activity size={16} color={C.cyan} />}
            />
            <StatCard
              label="Approval"
              value={approvalQueue.length}
              color={approvalQueue.length > 0 ? C.amber : C.muted}
              icon={<AlertTriangle size={16} color={approvalQueue.length > 0 ? C.amber : C.muted} />}
            />
            <StatCard
              label="Done"
              value={completedCount}
              color={C.green}
              icon={<CheckCircle2 size={16} color={C.green} />}
            />
          </View>

          {/* Approval Queue */}
          {approvalQueue.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={13} color={C.amber} />
                  <Text style={{ color: C.amber, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>NEEDS YOUR DECISION</Text>
                </View>
                <View style={{ backgroundColor: C.amber + '20', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: C.amber, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>{approvalQueue.length}</Text>
                </View>
              </View>
              {approvalQueue.map(wf => (
                <ApprovalRow
                  key={wf.id}
                  wf={wf}
                  onPress={() => openWorkflow(wf.id)}
                  onApprove={() => handleApprove(wf.id)}
                  onReject={() => handleReject(wf.id)}
                />
              ))}
            </View>
          )}

          {/* Active Workflows */}
          {activeWorkflows.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Zap size={13} color={C.cyan} />
                  <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>ACTIVE MISSIONS</Text>
                </View>
                <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{activeWorkflows.length} running</Text>
              </View>
              {activeWorkflows.slice(0, 3).map(wf => (
                <ActiveWorkflowRow key={wf.id} wf={wf} onPress={() => openWorkflow(wf.id)} />
              ))}
              {activeWorkflows.length > 3 && (
                <Pressable
                  onPress={() => router.push('/(tabs)/missions' as RelativePathString)}
                  style={{ alignItems: 'center', paddingVertical: 10 }}
                  className="active:opacity-70"
                >
                  <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace' }}>View all {activeWorkflows.length} →</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Recent Outputs */}
          {recentArtifacts.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Archive size={13} color={C.green} />
                  <Text style={{ color: C.green, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>RECENT OUTPUTS</Text>
                </View>
                <Pressable
                  onPress={() => router.push('/(tabs)/vault' as RelativePathString)}
                  className="active:opacity-70"
                >
                  <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>view all →</Text>
                </Pressable>
              </View>
              <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4 }}>
                {recentArtifacts.map(a => (
                  <RecentArtifactRow key={a.id} artifact={a} />
                ))}
              </View>
            </View>
          )}

          {/* System Health Summary */}
          {health && (
            <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Heart size={13} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>SYSTEM HEALTH</Text>
              </View>
              <Pressable
                onPress={() => router.push('/admin/health' as RelativePathString)}
                style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14 }}
                className="active:opacity-80"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: health.status === 'ok' ? C.green : C.amber }} />
                    <View>
                      <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }}>
                        {health.status === 'ok' ? 'All Systems Operational' : health.status === 'degraded' ? 'Degraded Performance' : 'System Issues Detected'}
                      </Text>
                      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>v{health.version}</Text>
                    </View>
                  </View>
                  <ChevronRight size={14} color={C.muted} />
                </View>
              </Pressable>
            </View>
          )}

          {/* Empty state when no workflows at all */}
          {workflows.length === 0 && !loading && !error && (
            <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32, gap: 12 }}>
              <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.cyan + '15', borderColor: C.cyan + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                <TrendingUp size={28} color={C.cyan} />
              </View>
              <Text style={{ color: C.fg, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>Ready for Launch</Text>
              <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                No active missions yet. Create a project in Forge, upload your code, and launch your first evolution.
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/launch' as RelativePathString);
                }}
                style={{ backgroundColor: C.cyan, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                className="active:opacity-80"
              >
                <Zap size={16} color={C.bg} />
                <Text style={{ color: C.bg, fontSize: 13, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>LAUNCH FIRST MISSION</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}

      {/* FAB */}
      {workflows.length > 0 && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/launch' as RelativePathString);
          }}
          style={{
            position: 'absolute', bottom: 24, right: 20,
            width: 54, height: 54, borderRadius: 27,
            backgroundColor: C.cyan, alignItems: 'center', justifyContent: 'center',
            shadowColor: C.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
            elevation: 8,
          }}
          className="active:opacity-80"
        >
          <Zap size={22} color={C.bg} />
        </Pressable>
      )}
    </View>
  );
}
