import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ArrowLeft, FolderKanban, Plus } from 'lucide-react-native';
import { projectsApi } from '@/api/projects';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function CreateProjectScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) { setError('Project name is required'); return; }
    setSaving(true);
    try {
      const project = await projectsApi.create(name.trim(), description.trim() || undefined);
      router.replace(`/projects/${project.id}` as RelativePathString);
    } catch (e: any) {
      setError(e.message ?? 'Failed to create project');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-14 pb-4 bg-card border-b border-border">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color="#94a3b8" />
          </Pressable>
          <View className="flex-row items-center gap-2 flex-1">
            <FolderKanban size={18} color="#a855f7" />
            <Text className="text-base font-mono font-bold text-foreground">NEW PROJECT</Text>
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} />}

      <ScrollView className="flex-1" contentContainerClassName="p-4 gap-4">
        <View className="gap-2">
          <Text className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Project Name *</Text>
          <TextInput
            className="bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono"
            placeholder="my-awesome-project"
            placeholderTextColor="#64748b"
            value={name}
            onChangeText={v => { setName(v); setError(null); }}
            autoFocus
            autoCapitalize="none"
          />
        </View>

        <View className="gap-2">
          <Text className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Description</Text>
          <TextInput
            className="bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground"
            placeholder="What does this project do?"
            placeholderTextColor="#64748b"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
        </View>

        <Pressable
          onPress={handleCreate}
          disabled={saving}
          className="flex-row items-center justify-center gap-2 bg-primary rounded-xl py-3 mt-2 active:opacity-70"
        >
          <Plus size={16} color="#fff" />
          <Text className="text-sm font-bold text-white font-mono">{saving ? 'CREATING…' : 'CREATE PROJECT'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
