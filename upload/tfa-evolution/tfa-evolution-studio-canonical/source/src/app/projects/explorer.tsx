import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Folder, File, ChevronRight } from 'lucide-react-native';
import { projectsApi } from '@/api/projects';
import { ErrorBanner } from '@/components/ErrorBanner';
import { EmptyState } from '@/components/EmptyState';
import { cn, formatBytes } from '@/lib/utils';

interface FileNode {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

function buildTree(entries: { path: string; type: 'file' | 'dir'; size?: number }[]): FileNode[] {
  const root: FileNode[] = [];
  const map: Record<string, FileNode> = {};

  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    const parts = entry.path.split('/');
    const node: FileNode = { path: entry.path, type: entry.type, size: entry.size };
    map[entry.path] = node;

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map[parentPath];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }
  return root;
}



function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const name = node.path.split('/').pop() ?? node.path;
  const isDir = node.type === 'dir';

  return (
    <View>
      <Pressable
        onPress={isDir ? () => setOpen(o => !o) : undefined}
        className={cn('flex-row items-center gap-2 py-1.5 pr-4', isDir && 'active:bg-secondary')}
        style={{ paddingLeft: 16 + depth * 16 }}
      >
        {isDir
          ? <Folder size={14} color={open ? '#3b82f6' : '#64748b'} />
          : <File size={14} color="#64748b" />
        }
        <Text
          className={cn('flex-1 text-xs font-mono', isDir ? 'text-blue-400' : 'text-muted-foreground')}
          numberOfLines={1}
        >
          {name}
        </Text>
        {!isDir && node.size != null && (
          <Text className="text-[9px] font-mono text-muted-foreground">{formatBytes(node.size)}</Text>
        )}
        {isDir && (
          <ChevronRight
            size={12}
            color="#64748b"
            style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
          />
        )}
      </Pressable>
      {isDir && open && node.children?.map(c => (
        <TreeNode key={c.path} node={c} depth={depth + 1} />
      ))}
    </View>
  );
}

export default function FileExplorerScreen() {
  const { id, versionId } = useLocalSearchParams<{ id: string; versionId?: string }>();
  const router = useRouter();
  const projectId = Number(id);
  const vid = versionId ? Number(versionId) : undefined;

  const [entries, setEntries] = useState<{ path: string; type: 'file' | 'dir'; size?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await projectsApi.files(projectId, vid);
        setEntries(data);
        setError(null);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load files');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, vid]));

  const tree = buildTree(entries);

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-14 pb-4 bg-card border-b border-border">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color="#94a3b8" />
          </Pressable>
          <View className="flex-row items-center gap-2 flex-1">
            <Folder size={18} color="#3b82f6" />
            <Text className="text-base font-mono font-bold text-foreground">FILE EXPLORER</Text>
          </View>
          <View className="bg-secondary border border-border rounded px-2 py-0.5">
            <Text className="text-[10px] font-mono text-muted-foreground">{entries.length} entries</Text>
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : entries.length === 0 ? (
        <EmptyState title="No files" description="No files found for this version." />
      ) : (
        <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
          <View className="bg-card border border-border rounded-2xl mx-4 mt-4 mb-8 overflow-hidden py-2" style={{ borderCurve: 'continuous' }}>
            {tree.map(n => <TreeNode key={n.path} node={n} depth={0} />)}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
