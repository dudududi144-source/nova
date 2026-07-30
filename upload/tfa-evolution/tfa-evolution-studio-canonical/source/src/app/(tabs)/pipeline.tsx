import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import type { RelativePathString } from 'expo-router';
import {
  GitBranch, CheckCircle2, XCircle, Download, AlertTriangle,
  ChevronRight, RefreshCw, Clock, Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { workflowsApi } from '@/api/workflows';
import { artifactsApi } from '@/api/artifacts';
import { StateBadge } from '@/components/StateBadge';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Workflow, Artifact } from '@/api/types';
import { getApiUrl } from '@/lib/api-client';
import { timeAgo, stageProgress, ACTIVE_STATES } from '@/lib/utils';
import { C } from '@/lib/design';

const CYAN   = C.cyan;
const AMBER  = C.amber;
const GREEN  = C.green;
const RED    = C.red;
const PURPLE = C.purple;

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, count, color, icon }: { label: string; count: number; color: string; icon: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Pressable onPress={() => setCollapsed(!collapsed)} className="active:opacity-70">
      <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
        <View className="flex-row items-center gap-2">
          {icon}
          <Text style={{ color, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
          <View style={{ backgroundColor: color + '22', borderColor: color + '44', borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>{count}</Text>
          </View>
        </View>
        <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{collapsed ? '▶' : '▼'}</Text>
      </View>
    </Pressable>
  );
}

// ─── Awaiting Decision row ────────────────────────────────────────────────────
function DecisionRow({ workflow, onApprove, onReject, onTap, approving }: {
  workflow: Workflow; onApprove: () => void; onReject: () => void;
  onTap: () => void; approving: boolean;
}) {
  const objective = workflow.userObjective ?? 'No objective';
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
      <Pressable onPress={onTap} className="active:bg-secondary px-4 pt-3 pb-2">
        <View className="flex-row items-start justify-between gap-2 mb-2">
          <View style={{ flex: 1, minWidth: 0 }}>
            <View className="flex-row items-center gap-2 mb-1">
              <Text style={{ color: AMBER, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>#{workflow.id}</Text>
              {workflow.projectName && (
                <Text style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>{workflow.projectName}</Text>
              )}
            </View>
            <Text style={{ color: '#cbd5e1', fontSize: 12 }} numberOfLines={2}>{objective}</Text>
          </View>
          <ChevronRight size={14} color="#334155" />
        </View>
      </Pressable>
      <View className="flex-row gap-2 px-4 pb-3">
        {approving ? (
          <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={CYAN} />
          </View>
        ) : (
          <>
            <Pressable onPress={onApprove} style={{ flex: 1, backgroundColor: GREEN + '18', borderColor: GREEN + '44', borderWidth: 1, borderRadius: 6, paddingVertical: 7, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} className="active:opacity-70">
              <CheckCircle2 size={12} color={GREEN} />
              <Text style={{ color: GREEN, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>APPROVE</Text>
            </Pressable>
            <Pressable onPress={onReject} style={{ flex: 1, backgroundColor: RED + '18', borderColor: RED + '44', borderWidth: 1, borderRadius: 6, paddingVertical: 7, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} className="active:opacity-70">
              <XCircle size={12} color={RED} />
              <Text style={{ color: RED, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>REJECT</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Active row ───────────────────────────────────────────────────────────────
function ActiveRow({ workflow, onTap }: { workflow: Workflow; onTap: () => void }) {
  const progress = stageProgress(workflow.state);
  return (
    <Pressable onPress={onTap} style={{ borderBottomWidth: 1, borderBottomColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 12 }} className="active:bg-secondary">
      <View className="flex-row items-center justify-between mb-2">
        <View>
          <Text style={{ color: CYAN, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>#{workflow.id}</Text>
          {workflow.projectName && <Text style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }}>{workflow.projectName}</Text>}
        </View>
        <StateBadge state={workflow.state} />
      </View>
      <View style={{ height: 3, backgroundColor: '#1e293b', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
        <View style={{ height: 3, width: `${progress}%`, backgroundColor: CYAN, borderRadius: 2 }} />
      </View>
      <View className="flex-row justify-between">
        <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{progress}% complete</Text>
        <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(workflow.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

// ─── Completed row ────────────────────────────────────────────────────────────
function CompletedRow({ workflow, artifact, onDownload, onTap }: {
  workflow: Workflow; artifact?: Artifact; onDownload: () => void; onTap: () => void;
}) {
  return (
    <Pressable onPress={onTap} style={{ borderBottomWidth: 1, borderBottomColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }} className="active:bg-secondary">
      <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: GREEN + '18', borderColor: GREEN + '33', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
        <CheckCircle2 size={14} color={GREEN} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} numberOfLines={1}>
          #{workflow.id}{workflow.projectName ? ` · ${workflow.projectName}` : ''}
        </Text>
        <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(workflow.updatedAt)}</Text>
      </View>
      {artifact && (
        <Pressable onPress={onDownload} style={{ backgroundColor: CYAN + '18', borderColor: CYAN + '44', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }} className="active:opacity-70">
          <Download size={11} color={CYAN} />
          <Text style={{ color: CYAN, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>GET</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Failed row ───────────────────────────────────────────────────────────────
function FailedRow({ workflow, onTap }: { workflow: Workflow; onTap: () => void }) {
  return (
    <Pressable onPress={onTap} style={{ borderBottomWidth: 1, borderBottomColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }} className="active:bg-secondary">
      <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: RED + '18', borderColor: RED + '33', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
        <XCircle size={14} color={RED} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }} numberOfLines={1}>
          #{workflow.id}{workflow.projectName ? ` · ${workflow.projectName}` : ''}
        </Text>
        <Text style={{ color: RED + 'aa', fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
          {workflow.errorMessage ?? 'Unknown error'}
        </Text>
      </View>
      <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(workflow.updatedAt)}</Text>
    </Pressable>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function PipelineScreen() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [wf, ar] = await Promise.all([
        workflowsApi.list().catch(() => []),
        artifactsApi.list().catch(() => []),
      ]);
      setWorkflows(wf);
      setArtifacts(ar);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(() => load(true), 6000);
    return () => clearInterval(timer);
  }, [load]));

  const handleApprove = useCallback(async (id: number) => {
    setApprovingId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await workflowsApi.approve(id);
      await load(true);
    } catch {
      setError('Approval failed');
    } finally {
      setApprovingId(null);
    }
  }, [load]);

  const handleReject = useCallback(async (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await workflowsApi.reject(id, 'Rejected via mobile app');
      await load(true);
    } catch {
      setError('Rejection failed');
    }
  }, [load]);

  const handleDownload = useCallback(async (wf: Workflow) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const apiUrl = await getApiUrl();
    const ar = artifacts.find(a => a.workflowId === wf.id);
    if (ar) await WebBrowser.openBrowserAsync(`${apiUrl}/api/artifacts/${ar.id}/download`);
    else if (wf.artifact) await WebBrowser.openBrowserAsync(`${apiUrl}/api/artifacts/${wf.artifact.id}/download`);
  }, [artifacts]);

  const approvalQueue = workflows.filter(w => w.state === 'awaiting_approval');
  const activeList = workflows.filter(w => ACTIVE_STATES.includes(w.state));
  const completedList = workflows.filter(w => w.state === 'ready_for_download' || w.state === 'completed')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const failedList = workflows.filter(w => w.state === 'failed' || w.state === 'rejected')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const artifactMap = new Map(artifacts.map(a => [a.workflowId, a]));

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={CYAN} />
        <Text style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', marginTop: 12 }}>LOADING PIPELINE...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View style={{ paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b', backgroundColor: '#080c14' }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <GitBranch size={18} color={CYAN} />
            <View>
              <Text style={{ color: '#e2e8f0', fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>PIPELINE</Text>
              <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace' }}>
                {workflows.length} total · {activeList.length + approvalQueue.length} active
              </Text>
            </View>
          </View>
          <Pressable onPress={() => load()} className="active:opacity-60">
            <RefreshCw size={16} color="#475569" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={CYAN} />}
      >
        {error && <ErrorBanner message={error} onRetry={() => load()} />}

        {/* Empty */}
        {workflows.length === 0 && (
          <View className="items-center justify-center px-8 pt-24">
            <GitBranch size={40} color="#1e293b" style={{ marginBottom: 16 }} />
            <Text style={{ color: '#475569', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', lineHeight: 18 }}>
              {'> No workflows in pipeline.\n> Launch your first evolution.'}
            </Text>
            <Pressable onPress={() => router.push('/launch' as RelativePathString)} style={{ marginTop: 20, backgroundColor: CYAN, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }} className="active:opacity-80">
              <Zap size={14} color="#0a0e17" />
              <Text style={{ color: '#0a0e17', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>LAUNCH EVOLUTION</Text>
            </Pressable>
          </View>
        )}

        {/* Awaiting Decision */}
        {approvalQueue.length > 0 && (
          <View style={{ backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e293b', marginBottom: 2 }}>
            <SectionHeader label="AWAITING DECISION" count={approvalQueue.length} color={AMBER} icon={<AlertTriangle size={14} color={AMBER} />} />
            {approvalQueue.map(w => (
              <DecisionRow key={w.id} workflow={w} approving={approvingId === w.id}
                onApprove={() => handleApprove(w.id)}
                onReject={() => handleReject(w.id)}
                onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)}
              />
            ))}
          </View>
        )}

        {/* Active */}
        {activeList.length > 0 && (
          <View style={{ backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e293b', marginBottom: 2 }}>
            <SectionHeader label="RUNNING" count={activeList.length} color={CYAN} icon={<Clock size={14} color={CYAN} />} />
            {activeList.map(w => (
              <ActiveRow key={w.id} workflow={w} onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)} />
            ))}
          </View>
        )}

        {/* Completed */}
        {completedList.length > 0 && (
          <View style={{ backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e293b', marginBottom: 2 }}>
            <SectionHeader label="COMPLETED" count={completedList.length} color={GREEN} icon={<CheckCircle2 size={14} color={GREEN} />} />
            {completedList.map(w => (
              <CompletedRow key={w.id} workflow={w}
                artifact={artifactMap.get(w.id) ?? (w.artifact as any)}
                onDownload={() => handleDownload(w)}
                onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)}
              />
            ))}
          </View>
        )}

        {/* Failed */}
        {failedList.length > 0 && (
          <View style={{ backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e293b', marginBottom: 2 }}>
            <SectionHeader label="FAILED" count={failedList.length} color={RED} icon={<XCircle size={14} color={RED} />} />
            {failedList.map(w => (
              <FailedRow key={w.id} workflow={w} onTap={() => router.push(`/workflows/${w.id}` as RelativePathString)} />
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
