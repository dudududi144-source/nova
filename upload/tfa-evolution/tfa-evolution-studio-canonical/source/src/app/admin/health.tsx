import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Heart, CheckCircle2, XCircle, Clock } from 'lucide-react-native';
import { healthApi } from '@/api/health';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { HealthData } from '@/api/types';
import { formatUptime } from '@/lib/utils';
import { C } from '@/lib/design';

export default function HealthDashboardScreen() {
  const router = useRouter();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await healthApi.get();
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load health data');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]));

  const statusColor = data?.status === 'ok' ? C.green : data?.status === 'degraded' ? C.amber : C.red;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Heart size={16} color={C.green} />
            <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>HEALTH DASHBOARD</Text>
          </View>
          {data && (
            <View style={{ backgroundColor: statusColor + '20', borderColor: statusColor + '50', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: statusColor, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>{data.status.toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', letterSpacing: 1.2, marginBottom: 10 }}>SYSTEM STATUS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: statusColor }} />
              <Text style={{ color: statusColor, fontSize: 24, fontFamily: 'monospace', fontWeight: '700' }}>
                {data?.status?.toUpperCase() ?? 'UNKNOWN'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {data?.version && <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>v{data.version}</Text>}
              {data?.uptime != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} color={C.muted} />
                  <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>{formatUptime(data.uptime)}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 }}>COMPONENTS</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
              <Text style={{ color: C.fg, fontSize: 13 }}>Database</Text>
              {data?.db ? <CheckCircle2 size={16} color={C.green} /> : <XCircle size={16} color={C.red} />}
            </View>
            {data?.checks && Object.entries(data.checks).map(([key, ok]) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
                <Text style={{ color: C.fg, fontSize: 13 }}>{key.replace(/_/g, ' ')}</Text>
                {ok ? <CheckCircle2 size={16} color={C.green} /> : <XCircle size={16} color={C.red} />}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
