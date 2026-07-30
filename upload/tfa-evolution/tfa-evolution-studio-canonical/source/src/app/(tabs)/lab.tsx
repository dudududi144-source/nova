import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlaskConical, ChevronRight, Zap, TrendingUp, AlertTriangle } from 'lucide-react-native';
import { agentsApi } from '@/api/agents';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { AgentStat } from '@/api/types';
import { formatMs, formatTokens } from '@/lib/utils';
import { C, TIER_COLORS } from '@/lib/design';

const TIER_CONFIG: Record<string, { label: string; desc: string }> = {
  executive:   { label: 'EXECUTIVE',   desc: 'Strategic coordination & oversight' },
  engineering: { label: 'ENGINEERING', desc: 'Code generation & transformation' },
  quality:     { label: 'QUALITY',     desc: 'Testing, QA & security validation' },
  release:     { label: 'RELEASE',     desc: 'Packaging & deployment preparation' },
};

function TierSummaryCard({ tier, agents }: { tier: string; agents: AgentStat[] }) {
  const color = TIER_COLORS[tier] ?? C.muted;
  const cfg = TIER_CONFIG[tier];
  const totalRuns = agents.reduce((s, a) => s + a.totalRuns, 0);
  const totalTokens = agents.reduce((s, a) => s + a.totalTokensUsed, 0);
  const totalCompleted = agents.reduce((s, a) => s + a.completedRuns, 0);
  const successRate = totalRuns > 0 ? Math.round((totalCompleted / totalRuns) * 100) : 0;
  const avgLatency = agents.length > 0
    ? agents.reduce((s, a) => s + (a.avgDurationMs ?? 0), 0) / agents.length
    : null;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12 }}>
      {/* Tier header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
        <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: color + '18', borderColor: color + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
          <FlaskConical size={16} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color, fontSize: 11, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>{cfg?.label ?? tier.toUpperCase()}</Text>
          <Text style={{ color: C.muted, fontSize: 10, marginTop: 1 }}>{cfg?.desc ?? ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: C.fg, fontSize: 14, fontFamily: 'monospace', fontWeight: '700' }}>{agents.length}</Text>
          <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>agents</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: 'row', padding: 12, gap: 0 }}>
        {[
          { label: 'RUNS', value: String(totalRuns) },
          { label: 'SUCCESS', value: `${successRate}%` },
          { label: 'TOKENS', value: formatTokens(totalTokens) },
          { label: 'AVG TIME', value: formatMs(avgLatency) },
        ].map((s, i, arr) => (
          <View key={s.label} style={{ flex: 1, alignItems: 'center', borderRightWidth: i < arr.length - 1 ? 1 : 0, borderRightColor: '#0f172a' }}>
            <Text style={{ color: C.fg, fontSize: 13, fontFamily: 'monospace', fontWeight: '700' }}>{s.value}</Text>
            <Text style={{ color: C.muted, fontSize: 8, fontFamily: 'monospace', marginTop: 2 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Agent list */}
      {agents.map((agent, idx) => {
        const rate = agent.totalRuns > 0 ? Math.round((agent.completedRuns / agent.totalRuns) * 100) : 0;
        return (
          <View key={agent.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: 14, paddingVertical: 11,
            borderTopWidth: 1, borderTopColor: '#0a0f18',
          }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 1 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: C.fg, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{agent.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <View style={{ flex: 1, height: 3, backgroundColor: '#1e293b', borderRadius: 2 }}>
                  <View style={{ height: 3, width: `${rate}%` as any, backgroundColor: color, borderRadius: 2 }} />
                </View>
                <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', minWidth: 28 }}>{rate}%</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{agent.totalRuns} runs</Text>
              <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace' }}>{formatTokens(agent.totalTokensUsed)} tok</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function LabScreen() {
  const [byTier, setByTier] = useState<Record<string, AgentStat[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await agentsApi.observatory();
      setByTier(data.byTier as any);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load agent data');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const allAgents = Object.values(byTier).flat();
  const totalRuns = allAgents.reduce((s, a) => s + a.totalRuns, 0);
  const totalTokens = allAgents.reduce((s, a) => s + a.totalTokensUsed, 0);
  const totalCompleted = allAgents.reduce((s, a) => s + a.completedRuns, 0);
  const overallSuccess = totalRuns > 0 ? Math.round((totalCompleted / totalRuns) * 100) : 0;
  const tierOrder = ['executive', 'engineering', 'quality', 'release'];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={18} color={C.cyan} />
          <Text style={{ color: C.fg, fontSize: 18, fontFamily: 'monospace', fontWeight: '700' }}>LAB</Text>
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>agent observatory</Text>
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !allAgents.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color={C.cyan} />
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>LOADING AGENTS...</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          {/* Global totals banner */}
          {allAgents.length > 0 && (
            <View style={{ marginHorizontal: 16, marginBottom: 20, backgroundColor: C.cyan + '08', borderColor: C.cyan + '30', borderWidth: 1, borderRadius: 12, padding: 14 }}>
              <Text style={{ color: C.cyan, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, marginBottom: 12 }}>GLOBAL TOTALS</Text>
              <View style={{ flexDirection: 'row', gap: 0 }}>
                {[
                  { label: 'AGENTS', value: String(allAgents.length) },
                  { label: 'TOTAL RUNS', value: String(totalRuns) },
                  { label: 'SUCCESS', value: `${overallSuccess}%` },
                  { label: 'TOKENS', value: formatTokens(totalTokens) },
                ].map((s, i, arr) => (
                  <View key={s.label} style={{ flex: 1, alignItems: 'center', borderRightWidth: i < arr.length - 1 ? 1 : 0, borderRightColor: C.cyan + '30' }}>
                    <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>{s.value}</Text>
                    <Text style={{ color: C.cyan, fontSize: 8, fontFamily: 'monospace', marginTop: 2 }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {allAgents.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
              <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.purple + '15', borderColor: C.purple + '30', borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <FlaskConical size={28} color={C.purple} />
              </View>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 8 }}>No Agent Data Yet</Text>
              <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                Run your first evolution to see agent performance metrics, success rates, and token usage here.
              </Text>
            </View>
          ) : (
            tierOrder.map(tier => {
              const agents = byTier[tier] ?? [];
              if (!agents.length) return null;
              return <TierSummaryCard key={tier} tier={tier} agents={agents} />;
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
