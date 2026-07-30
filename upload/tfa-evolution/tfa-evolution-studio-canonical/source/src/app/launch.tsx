import {
  View, Text, ScrollView, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  Zap, ChevronLeft, FolderOpen, Upload, FileText,
  CheckCircle2, Plus, Layers, Clock, BookOpen, ChevronRight,
} from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { projectsApi } from '@/api/projects';
import { workflowsApi } from '@/api/workflows';
import type { Project, ProjectVersion } from '@/api/types';
import { formatBytes, timeAgo } from '@/lib/utils';
import { C } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

type Step = 1 | 2 | 3 | 4;

const QUICK_OBJECTIVES = [
  'Add comprehensive unit test coverage with at least 80% line coverage',
  'Refactor database layer to use the repository pattern',
  'Migrate to TypeScript with strict mode enabled',
  'Add JWT authentication with refresh tokens',
  'Implement Redis caching layer for API responses',
  'Add Docker containerization with docker-compose',
];

function StepProgress({ current }: { current: Step }) {
  const steps = ['Project', 'Version', 'Objective', 'Launch'];
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0 }}>
        {steps.map((label, i) => {
          const num = i + 1;
          const done = num < current;
          const active = num === current;
          return (
            <View key={label} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                {i > 0 && <View style={{ flex: 1, height: 1, backgroundColor: done ? C.cyan : C.border }} />}
                <View style={{
                  width: 24, height: 24, borderRadius: 12,
                  backgroundColor: done ? C.cyan : active ? C.cyan + '30' : C.card,
                  borderColor: done || active ? C.cyan : C.border,
                  borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                }}>
                  {done
                    ? <CheckCircle2 size={14} color={C.bg} />
                    : <Text style={{ color: active ? C.cyan : C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>{num}</Text>
                  }
                </View>
                {i < steps.length - 1 && <View style={{ flex: 1, height: 1, backgroundColor: done ? C.cyan : C.border }} />}
              </View>
              <Text style={{ color: active ? C.cyan : done ? C.cyan + 'AA' : C.muted, fontSize: 9, fontFamily: 'monospace', fontWeight: '700', marginTop: 4 }}>
                {label.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function LaunchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const preselectedProjectId = params.projectId ? Number(params.projectId) : null;
  const prefilledObjective = typeof params.objective === 'string' ? params.objective : '';

  const [step, setStep] = useState<Step>(preselectedProjectId ? 2 : 1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<ProjectVersion | null>(null);
  const [objective, setObjective] = useState(prefilledObjective);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectsApi.list();
      setProjects(data);
      if (preselectedProjectId) {
        const p = data.find(x => x.id === preselectedProjectId);
        if (p) { setSelectedProject(p); loadVersions(p.id); }
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [preselectedProjectId]);

  useFocusEffect(useCallback(() => { loadProjects(); }, [loadProjects]));

  // Sync pre-filled objective from templates
  const incomingObjective = typeof params.objective === 'string' ? params.objective : '';
  useFocusEffect(useCallback(() => {
    if (incomingObjective && !objective) setObjective(incomingObjective);
  }, [incomingObjective]));

  const loadVersions = useCallback(async (projectId: number) => {
    setLoading(true);
    try {
      const data = await projectsApi.versions(projectId);
      setVersions(data.sort((a, b) => b.versionNumber - a.versionNumber));
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  const createProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setLoading(true);
    try {
      const p = await projectsApi.create(newProjectName.trim());
      setProjects(prev => [p, ...prev]);
      setSelectedProject(p);
      setVersions([]);
      setNewProjectName('');
      setShowNewProject(false);
      setStep(2);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [newProjectName]);

  const uploadVersion = useCallback(async () => {
    if (!selectedProject) return;
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const v = await projectsApi.upload(selectedProject.id, asset.uri, asset.name);
      setVersions(prev => [v, ...prev]);
      setSelectedVersion(v);
    } catch (e: any) { setError(e.message ?? 'Upload failed'); }
    finally { setUploading(false); }
  }, [selectedProject]);

  const launch = useCallback(async () => {
    if (!selectedProject || !selectedVersion || !objective.trim()) return;
    setLaunching(true);
    setError(null);
    try {
      const wf = await workflowsApi.create(selectedProject.id, selectedVersion.id, objective.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/workflows/${wf.id}` as RelativePathString);
    } catch (e: any) {
      setError(e.message ?? 'Failed to launch');
      setLaunching(false);
    }
  }, [selectedProject, selectedVersion, objective, router]);

  const canProceed = step === 1 ? !!selectedProject : step === 2 ? !!selectedVersion : step === 3 ? objective.trim().length > 10 : true;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 0, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 14 }}>
          <Pressable onPress={() => { if (step > 1) setStep(s => (s - 1) as Step); else router.back(); }} className="active:opacity-60">
            <ChevronLeft size={22} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Zap size={18} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>LAUNCH EVOLUTION</Text>
          </View>
        </View>
        <StepProgress current={step} />
      </View>

      {error && (
        <View style={{ backgroundColor: C.red + '18', borderBottomWidth: 1, borderBottomColor: C.red + '40', paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ color: C.red, fontSize: 12, fontFamily: 'monospace' }}>{error}</Text>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">

          {/* ─── STEP 1: SELECT PROJECT ─── */}
          {step === 1 && (
            <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>Select Project</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>Choose the project you want to evolve</Text>

              {loading ? <ActivityIndicator color={C.cyan} /> : (
                <>
                  {projects.map(p => (
                    <Pressable
                      key={p.id}
                      onPress={() => { setSelectedProject(p); setSelectedVersion(null); loadVersions(p.id); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 12,
                        backgroundColor: selectedProject?.id === p.id ? C.cyan + '15' : C.card,
                        borderColor: selectedProject?.id === p.id ? C.cyan + '60' : C.border,
                        borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 8,
                      }}
                      className="active:opacity-80"
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.cyan + '18', alignItems: 'center', justifyContent: 'center' }}>
                        <FolderOpen size={16} color={C.cyan} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                        <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>
                          {p.versionCount ?? 0} versions · {timeAgo(p.updatedAt)}
                        </Text>
                      </View>
                      {selectedProject?.id === p.id && <CheckCircle2 size={18} color={C.cyan} />}
                    </Pressable>
                  ))}

                  {/* New project inline */}
                  {showNewProject ? (
                    <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 8 }}>
                      <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', marginBottom: 6 }}>NEW PROJECT NAME</Text>
                      <TextInput
                        value={newProjectName} onChangeText={setNewProjectName}
                        placeholder="my-awesome-project"
                        placeholderTextColor={C.muted}
                        style={{ color: C.fg, fontSize: 14, backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 }}
                        autoFocus
                      />
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable onPress={() => setShowNewProject(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, borderColor: C.border, borderWidth: 1 }} className="active:opacity-70">
                          <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>CANCEL</Text>
                        </Pressable>
                        <Pressable onPress={createProject} disabled={!newProjectName.trim() || loading} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, backgroundColor: C.cyan }} className="active:opacity-70">
                          <Text style={{ color: C.bg, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>CREATE</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setShowNewProject(true)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: C.border, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, padding: 14, marginBottom: 8 }}
                      className="active:opacity-70"
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Plus size={16} color={C.muted} />
                      </View>
                      <Text style={{ color: C.muted, fontSize: 13 }}>Create new project</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}

          {/* ─── STEP 2: SELECT / UPLOAD VERSION ─── */}
          {step === 2 && selectedProject && (
            <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>Select Version</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>
                Pick an uploaded version of <Text style={{ color: C.fg }}>{selectedProject.name}</Text>
              </Text>

              {loading ? <ActivityIndicator color={C.cyan} /> : (
                <>
                  {/* Upload new */}
                  <Pressable
                    onPress={uploadVersion}
                    disabled={uploading}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.purple + '10', borderColor: C.purple + '40', borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 12 }}
                    className="active:opacity-80"
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.purple + '20', alignItems: 'center', justifyContent: 'center' }}>
                      {uploading ? <ActivityIndicator size="small" color={C.purple} /> : <Upload size={16} color={C.purple} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }}>Upload new version</Text>
                      <Text style={{ color: C.muted, fontSize: 10 }}>ZIP or any archive file</Text>
                    </View>
                  </Pressable>

                  {versions.map(v => (
                    <Pressable
                      key={v.id}
                      onPress={() => setSelectedVersion(v)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 12,
                        backgroundColor: selectedVersion?.id === v.id ? C.cyan + '12' : C.card,
                        borderColor: selectedVersion?.id === v.id ? C.cyan + '60' : C.border,
                        borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 8,
                      }}
                      className="active:opacity-80"
                    >
                      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: C.blue + '18', alignItems: 'center', justifyContent: 'center' }}>
                        <FileText size={16} color={C.blue} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }}>v{v.versionNumber} — {v.filename}</Text>
                        <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace' }}>
                          {formatBytes(v.fileSize)} · {timeAgo(v.createdAt)}
                        </Text>
                      </View>
                      {selectedVersion?.id === v.id && <CheckCircle2 size={18} color={C.cyan} />}
                    </Pressable>
                  ))}

                  {versions.length === 0 && (
                    <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>
                      No versions yet — upload your first ZIP above
                    </Text>
                  )}
                </>
              )}
            </View>
          )}

          {/* ─── STEP 3: OBJECTIVE ─── */}
          {step === 3 && (
            <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>Define Objective</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>What should the AI agents accomplish?</Text>

              <TextInput
                value={objective}
                onChangeText={setObjective}
                placeholder="Describe what you want the AI to do with your code..."
                placeholderTextColor={C.muted}
                multiline
                numberOfLines={5}
                style={{
                  color: C.fg, fontSize: 13, lineHeight: 20,
                  backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
                  borderRadius: 10, padding: 14, minHeight: 120,
                  marginBottom: 16, textAlignVertical: 'top',
                }}
              />
              <Text style={{ color: objective.length < 10 ? C.red : C.muted, fontSize: 10, fontFamily: 'monospace', marginBottom: 16 }}>
                {objective.length} chars {objective.length < 10 ? '(min 10)' : '✓'}
              </Text>

              {/* Quick-fill templates */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>QUICK FILL</Text>
                <Pressable
                  onPress={() => router.push({ pathname: '/templates' as RelativePathString, params: { select: '1' } })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  className="active:opacity-70"
                >
                  <BookOpen size={12} color={C.cyan} />
                  <Text style={{ color: C.cyan, fontSize: 11, fontFamily: 'monospace' }}>Browse all templates →</Text>
                </Pressable>
              </View>
              {QUICK_OBJECTIVES.map((q, i) => (
                <Pressable
                  key={i}
                  onPress={() => { setObjective(q); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 8, marginBottom: 6 }}
                  className="active:opacity-70"
                >
                  <ChevronRight size={12} color={C.muted} />
                  <Text style={{ color: C.fg, fontSize: 12, flex: 1 }} numberOfLines={1}>{q}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* ─── STEP 4: REVIEW ─── */}
          {step === 4 && selectedProject && selectedVersion && (
            <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>Review & Launch</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>Confirm your evolution mission</Text>

              {[
                { label: 'PROJECT', value: selectedProject.name, icon: <FolderOpen size={14} color={C.cyan} /> },
                { label: 'VERSION', value: `v${selectedVersion.versionNumber} · ${selectedVersion.filename}`, icon: <FileText size={14} color={C.blue} /> },
              ].map(row => (
                <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 8 }}>
                  {row.icon}
                  <View>
                    <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', letterSpacing: 0.8 }}>{row.label}</Text>
                    <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{row.value}</Text>
                  </View>
                </View>
              ))}

              <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 20 }}>
                <Text style={{ color: C.muted, fontSize: 9, fontFamily: 'monospace', letterSpacing: 0.8, marginBottom: 6 }}>OBJECTIVE</Text>
                <Text style={{ color: C.fg, fontSize: 13, lineHeight: 20 }}>{objective}</Text>
              </View>

              <Pressable
                onPress={launch}
                disabled={launching}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                  backgroundColor: launching ? C.cyan + '60' : C.cyan,
                  borderRadius: 12, paddingVertical: 16,
                }}
                className="active:opacity-80"
              >
                {launching ? <ActivityIndicator color={C.bg} /> : <Zap size={20} color={C.bg} />}
                <Text style={{ color: C.bg, fontSize: 15, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1 }}>
                  {launching ? 'LAUNCHING...' : 'LAUNCH EVOLUTION'}
                </Text>
              </Pressable>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom nav */}
      {step < 4 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Pressable
            onPress={() => { if (canProceed) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(s => (s + 1) as Step); } }}
            disabled={!canProceed}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: canProceed ? C.cyan : C.border, borderRadius: 10, paddingVertical: 14 }}
            className="active:opacity-80"
          >
            <Text style={{ color: canProceed ? C.bg : C.muted, fontSize: 14, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8 }}>
              {step === 1 ? 'SELECT PROJECT' : step === 2 ? 'SELECT VERSION' : 'SET OBJECTIVE'} →
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
