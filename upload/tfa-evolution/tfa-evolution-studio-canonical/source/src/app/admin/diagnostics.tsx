import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Stethoscope, CheckCircle2, XCircle, RefreshCw, Wifi } from 'lucide-react-native';
import { providersApi } from '@/api/providers';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { Provider } from '@/api/types';
import { C } from '@/lib/design';

export default function DiagnosticsScreen() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pingingAll, setPingingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await providersApi.list();
      setProviders(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load providers');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pingAll = useCallback(async () => {
    setPingingAll(true);
    try { await providersApi.pingAll?.(); await load(); }
    catch { /* */ } finally { setPingingAll(false); }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Stethoscope size={16} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>DIAGNOSTICS</Text>
          </View>
          <Pressable
            onPress={pingAll} disabled={pingingAll}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: C.cyan + '18', borderColor: C.cyan + '40', borderWidth: 1, borderRadius: 8 }}
            className="active:opacity-70"
          >
            {pingingAll ? <ActivityIndicator size="small" color={C.cyan} /> : <RefreshCw size={12} color={C.cyan} />}
            <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>PING ALL</Text>
          </Pressable>
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !providers.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
        >
          {providers.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Stethoscope size={32} color={C.border} />
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>No providers configured</Text>
            </View>
          ) : providers.map(p => (
            <View key={p.id} style={{ backgroundColor: C.card, borderColor: p.available ? C.green + '30' : C.border, borderWidth: 1, borderRadius: 12, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <Text style={{ color: C.fg, fontSize: 13, fontWeight: '700' }}>{p.displayName ?? p.name}</Text>
                    {p.isDefault && (
                      <View style={{ backgroundColor: C.purple + '18', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ color: C.purple, fontSize: 8, fontFamily: 'monospace', fontWeight: '700' }}>DEFAULT</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>{p.model}</Text>
                </View>
                <View style={{ alignItems: 'center', gap: 2 }}>
                  {p.available ? <CheckCircle2 size={18} color={C.green} /> : <XCircle size={18} color={C.red} />}
                  <Text style={{ color: p.available ? C.green : C.red, fontSize: 8, fontFamily: 'monospace', fontWeight: '700' }}>
                    {p.available ? 'ONLINE' : 'OFFLINE'}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {p.latencyMs != null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Wifi size={11} color={C.muted} />
                    <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>{p.latencyMs}ms</Text>
                  </View>
                )}
                {[
                  { label: 'Enabled', value: p.enabled },
                  { label: 'API Key', value: p.apiKeyConfigured },
                ].map(({ label, value }) => (
                  <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {value ? <CheckCircle2 size={11} color={C.green} /> : <XCircle size={11} color={C.red} />}
                    <Text style={{ color: C.muted, fontSize: 11 }}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
