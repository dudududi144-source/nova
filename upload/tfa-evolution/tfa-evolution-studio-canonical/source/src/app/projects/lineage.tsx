import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, GitBranch, Circle, ChevronDown } from 'lucide-react-native';
import { projectsApi } from '@/api/projects';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState } from '@/components/EmptyState';

function LineageNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <View style={{ paddingLeft: depth * 20 }}>
      <View className="flex-row items-start gap-2 mb-2">
        {depth > 0 && (
          <View className="items-center" style={{ marginTop: 2 }}>
            <View className="w-px bg-border" style={{ height: 10 }} />
            <View className="w-4 h-px bg-border" />
          </View>
        )}
        <View className="flex-1 bg-card border border-border rounded-xl p-3" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Circle size={10} color="#3b82f6" fill="#3b82f6" />
              <Text className="text-sm font-mono font-bold text-primary">v{node.versionNumber ?? node.version ?? '?'}</Text>
            </View>
            {hasChildren && (
              <Pressable onPress={() => setOpen(o => !o)} className="active:opacity-60">
                <ChevronDown size={14} color="#64748b" style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }} />
              </Pressable>
            )}
          </View>
          {node.filename && (
            <Text className="text-xs text-muted-foreground mt-1" numberOfLines={1}>{node.filename}</Text>
          )}
          {node.createdAt && (
            <Text className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {new Date(node.createdAt).toLocaleString()}
            </Text>
          )}
        </View>
      </View>
      {open && hasChildren && node.children.map((child: any, i: number) => (
        <LineageNode key={i} node={child} depth={depth + 1} />
      ))}
    </View>
  );
}

export default function LineageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const projectId = Number(id);

  const [lineage, setLineage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await projectsApi.lineage(projectId);
        setLineage(data);
        setError(null);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load lineage');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]));

  const nodes = lineage ? (Array.isArray(lineage) ? lineage : [lineage]) : [];

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-14 pb-4 bg-card border-b border-border">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color="#94a3b8" />
          </Pressable>
          <View className="flex-row items-center gap-2 flex-1">
            <GitBranch size={18} color="#a855f7" />
            <Text className="text-base font-mono font-bold text-foreground">LINEAGE</Text>
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : nodes.length === 0 ? (
        <EmptyState title="No lineage data" description="Lineage data is not available for this project." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="p-4 pb-12">
          {nodes.map((n: any, i: number) => <LineageNode key={i} node={n} depth={0} />)}
        </ScrollView>
      )}
    </View>
  );
}
