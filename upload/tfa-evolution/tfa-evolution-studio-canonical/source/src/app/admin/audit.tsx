import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, ScrollText } from 'lucide-react-native';
import { auditApi } from '@/api/audit';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { AuditEntry } from '@/api/types';
import { timeAgo } from '@/lib/utils';
import { C } from '@/lib/design';

const ACTION_COLOR: Record<string, string> = {
  create: C.green, update: C.cyan, delete: C.red,
  upload: C.purple, approve: C.green, reject: C.amber,
  login: C.slate, logout: C.slate,
};
function entryColor(action: string): string {
  for (const [k, v] of Object.entries(ACTION_COLOR)) {
    if (action.toLowerCase().includes(k)) return v;
  }
  return C.muted;
}

export default function AuditLogScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await auditApi.list();
      setEntries(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load audit log');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = useCallback(({ item }: { item: AuditEntry }) => {
    const color = entryColor(item.action);
    return (
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0a0f18' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 4 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
            <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {item.action.replace(/_/g, ' ')}
            </Text>
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{timeAgo(item.createdAt)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {item.resourceType && (
              <View style={{ backgroundColor: color + '18', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ color, fontSize: 9, fontFamily: 'monospace', fontWeight: '700' }}>
                  {item.resourceType}{item.resourceId ? ` #${item.resourceId}` : ''}
                </Text>
              </View>
            )}
            {item.ip && <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{item.ip}</Text>}
          </View>
          {item.details && (
            <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 4 }} numberOfLines={2}>{item.details}</Text>
          )}
        </View>
      </View>
    );
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <ScrollText size={16} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>AUDIT LOG</Text>
          </View>
          {entries.length > 0 && (
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>{entries.length} entries</Text>
          )}
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !entries.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.cyan} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cyan} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <ScrollText size={32} color={C.border} />
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>No audit entries</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
