import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, CheckCircle2, XCircle, Download,
  ChevronDown, ChevronRight, AlertTriangle, Zap,
} from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { workflowsApi } from '@/api/workflows';
import { StateBadge } from '@/components/StateBadge';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Workflow, WorkflowAgent } from '@/api/types';
import { getApiUrl } from '@/lib/api-client';
import { formatMs, formatTokens, stageLabel, timeAgo, ACTIVE_STATES } from '@/lib/utils';
import { C, stateColor, TIER_COLORS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

const STAGE_STEPS = [
  'extracting', 'analyzing', 'plan_generated', 'awaiting_approval',
  'executing_agents', 'qa_running', 'packaging', 'ready_for_download',
];
const STAGE_SHORT: Record<string, string> = {
  extracting: 'Extract', analyzing: 'Analyze', plan_generated: 'Plan',
  awaiting_approval: 'Review', executing_agents: 'Execute',
  qa_running: 'QA', packaging: 'Package', ready_for_download: 'Done',
};

function StageRail({ state }: { state: string }) {
  const currentIdx = STAGE_STEPS.indexOf(state);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {STAGE_STEPS.map((s, i) => {
          const done = i < currentIdx || state === 'completed' || state === 'ready_for_download';
          const active = i === currentIdx;
          const failed = state === 'failed' || state === 'rejected';
          const color = failed && active ? C.red : done || active ? C.cyan : C.border;
          return (
            <View key={s} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                {i > 0 && <View style={{ flex: 1, height: 1.5, backgroundColor: done ? C.cyan : C.border }} />}
                <View style={{
                  width: 18, height: 18, borderRadius: 9,
                  backgroundColor: done ? C.cyan : active ? (failed ? C.red : C.cyan + '30') : '#1e293b',
                  borderColor: color, borderWidth: 1,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {done && <CheckCircle2 size={11} color={C.bg} />}
                  {active && !done && (
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: failed ? C.red : C.cyan }} />
                  )}
                </View>
                {i < STAGE_STEPS.length - 1 && <View style={{ flex: 1, height: 1.5, backgroundColor: done ? C.cyan : C.border }} />}
              </View>
              <Text style={{ color: done || active ? (failed && active ? C.red : C.cyan) : C.muted, fontSize: 7, fontFamily: 'monospace', marginTop: 3, textAlign: 'center' }}>
                {STAGE_SHORT[s]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function AgentRow({ agent }: { agent: WorkflowAgent }) {
  const [expanded, setExpanded] = useState(false);
  const tierColor = TIER_COLORS[agent.tier] ?? C.muted;
  const statusColor = agent.status === 'completed' ? C.green : agent.status === 'running' ? C.cyan : agent.status === 'failed' ? C.red : C.muted;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
      <Pressable
        onPress={() => { setExpanded(e => !e); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}
        className="active:opacity-80"
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tierColor, marginTop: 1 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: C.fg, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{agent.agentName}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 3 }}>
            <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>{formatMs(agent.durationMs ?? null)}</Text>
            {agent.tokensUsed > 0 && <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>{formatTokens(agent.tokensUsed)} tokens</Text>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ backgroundColor: statusColor + '18', borderColor: statusColor + '40', borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: statusColor, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>{agent.status.toUpperCase()}</Text>
          </View>
          {agent.output && (expanded ? <ChevronDown size={12} color={C.muted} /> : <ChevronRight size={12} color={C.muted} />)}
        </View>
      </Pressable>

      {expanded && agent.output && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: '#060a0f', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#1e293b' }}>
          <Text style={{ color: '#94a3b8', fontSize: 10, lineHeight: 16, fontFamily: 'monospace' }}>{agent.output}</Text>
        </View>
      )}
      {expanded && agent.error && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: C.red + '08', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: C.red + '30' }}>
          <Text style={{ color: C.red, fontSize: 10, lineHeight: 16, fontFamily: 'monospace' }}>{agent.error}</Text>
        </View>
      )}
      {expanded && agent.fileOps && agent.fileOps.length > 0 && (
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          {agent.fileOps.slice(0, 5).map((op, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
              <View style={{
                backgroundColor: op.op === 'create' ? C.green + '18' : op.op === 'modify' ? C.cyan + '18' : op.op === 'delete' ? C.red + '18' : C.amber + '18',
                borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1,
              }}>
                <Text style={{ color: op.op === 'create' ? C.green : op.op === 'modify' ? C.cyan : op.op === 'delete' ? C.red : C.amber, fontSize: 8, fontFamily: 'monospace', fontWeight: '700' }}>
                  {op.op.toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>{op.path}</Text>
            </View>
          ))}
          {agent.fileOps.length > 5 && (
            <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', paddingVertical: 2 }}>+{agent.fileOps.length - 5} more files</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await workflowsApi.get(Number(id));
      setWorkflow(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load workflow');
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => {
    load();
    const isActive = workflow && ACTIVE_STATES.includes(workflow.state);
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]));

  const handleApprove = useCallback(async () => {
    if (!workflow) return;
    setApproving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try { await workflowsApi.approve(workflow.id); await load(); }
    catch { /* */ } finally { setApproving(false); }
  }, [workflow, load]);

  const handleReject = useCallback(async () => {
    if (!workflow) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try { await workflowsApi.reject(workflow.id, 'Rejected by user'); await load(); }
    catch { /* */ }
  }, [workflow, load]);

  const handleDownload = useCallback(async () => {
    if (!workflow?.artifact) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const base = await getApiUrl();
    await WebBrowser.openBrowserAsync(`${base}/api/artifacts/${workflow.artifact.id}/download`);
  }, [workflow]);

  const statusColor = workflow ? stateColor(workflow.state) : C.muted;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.fg, fontSize: 15, fontFamily: 'monospace', fontWeight: '700' }} numberOfLines={1}>
              {workflow?.projectName ?? `Workflow #${id}`}
            </Text>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>#{id}</Text>
          </View>
          {workflow && <StateBadge state={workflow.state} size="md" />}
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !workflow ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color={C.cyan} size="large" />
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>LOADING WORKFLOW...</Text>
        </View>
      ) : !workflow ? null : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          {/* Stage rail */}
          <View style={{ backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <StageRail state={workflow.state} />
          </View>

          {/* Objective */}
          <View style={{ padding: 16 }}>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 6 }}>OBJECTIVE</Text>
            <Text style={{ color: C.fg, fontSize: 14, lineHeight: 22 }}>{workflow.userObjective ?? '—'}</Text>
          </View>

          {/* Analysis & Plan cards */}
          {workflow.analysis && (
            <View style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 14 }}>
              <Text style={{ color: C.cyan, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}>CODEBASE ANALYSIS</Text>
              {[
                { label: 'Language', value: workflow.analysis.language?.join(', ') ?? '—' },
                { label: 'Frameworks', value: workflow.analysis.frameworks?.join(', ') ?? '—' },
                { label: 'Complexity', value: workflow.analysis.complexity },
                { label: 'Files', value: workflow.analysis.fileCount?.toString() },
              ].filter(r => r.value).map(row => (
                <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
                  <Text style={{ color: C.muted, fontSize: 12 }}>{row.label}</Text>
                  <Text style={{ color: C.fg, fontSize: 12, fontFamily: 'monospace' }}>{row.value}</Text>
                </View>
              ))}
              {workflow.analysis.summary && (
                <Text style={{ color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 8 }}>{workflow.analysis.summary}</Text>
              )}
            </View>
          )}

          {/* Approval section */}
          {workflow.state === 'awaiting_approval' && workflow.plan && (
            <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: C.amber + '08', borderColor: C.amber + '40', borderWidth: 1, borderRadius: 12, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <AlertTriangle size={14} color={C.amber} />
                <Text style={{ color: C.amber, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>PLAN READY — REVIEW REQUIRED</Text>
              </View>
              {workflow.plan.objectives?.map((obj, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                  <Text style={{ color: C.amber, fontSize: 11, fontFamily: 'monospace' }}>{i + 1}.</Text>
                  <Text style={{ color: C.fg, fontSize: 12, flex: 1, lineHeight: 18 }}>{obj}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={handleApprove} disabled={approving}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.green + '18', borderColor: C.green + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 12 }}
                  className="active:opacity-70"
                >
                  {approving ? <ActivityIndicator size="small" color={C.green} /> : <CheckCircle2 size={15} color={C.green} />}
                  <Text style={{ color: C.green, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>APPROVE & EXECUTE</Text>
                </Pressable>
                <Pressable
                  onPress={handleReject}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.red + '18', borderColor: C.red + '50', borderWidth: 1, borderRadius: 8, paddingVertical: 12 }}
                  className="active:opacity-70"
                >
                  <XCircle size={15} color={C.red} />
                  <Text style={{ color: C.red, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>REJECT</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Download button */}
          {(workflow.state === 'ready_for_download' || workflow.state === 'completed') && workflow.artifact && (
            <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
              <Pressable
                onPress={handleDownload}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.green, borderRadius: 12, paddingVertical: 14 }}
                className="active:opacity-80"
              >
                <Download size={18} color={C.bg} />
                <Text style={{ color: C.bg, fontSize: 14, fontFamily: 'monospace', fontWeight: '700' }}>
                  DOWNLOAD EVOLVED CODE
                </Text>
              </Pressable>
            </View>
          )}

          {/* Agent timeline */}
          {workflow.agents && workflow.agents.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
                <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 }}>AGENT TIMELINE</Text>
              </View>
              <View style={{ backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
                {workflow.agents.map(a => <AgentRow key={a.id} agent={a} />)}
              </View>
            </View>
          )}

          {/* Metadata */}
          <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 }}>METADATA</Text>
            </View>
            {[
              { label: 'Workflow ID', value: `#${workflow.id}` },
              { label: 'Project ID', value: `#${workflow.projectId}` },
              { label: 'Version ID', value: `#${workflow.versionId}` },
              { label: 'Created', value: timeAgo(workflow.createdAt) },
              { label: 'Updated', value: timeAgo(workflow.updatedAt) },
              ...(workflow.approvedAt ? [{ label: 'Approved', value: timeAgo(workflow.approvedAt) }] : []),
            ].map(row => (
              <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
                <Text style={{ color: C.muted, fontSize: 12 }}>{row.label}</Text>
                <Text style={{ color: C.fg, fontSize: 12, fontFamily: 'monospace' }}>{row.value}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}
