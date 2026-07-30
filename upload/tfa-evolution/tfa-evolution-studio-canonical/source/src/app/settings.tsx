import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Switch,
} from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft, Settings, Wifi, WifiOff, Save, RefreshCw,
  Info, Shield, Cpu,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { settingsApi } from '@/api/settings';
import { healthApi } from '@/api/health';
import { ErrorBanner } from '@/components/ErrorBanner';
import type { AppSettings } from '@/api/types';
import { C } from '@/lib/design';
import { formatUptime } from '@/lib/utils';

const API_URL_KEY = 'tfa_api_url';
const DEFAULT_API_URL = 'http://localhost:4000';

type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error';

export default function SettingsScreen() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionMsg, setConnectionMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);

  const load = useCallback(async () => {
    const url = (await AsyncStorage.getItem(API_URL_KEY)) ?? DEFAULT_API_URL;
    setApiUrl(url);
    setSavedUrl(url);
    try {
      const s = await settingsApi.get();
      setAppSettings(s);
      setAutoApprove(s.auto_approve === 'true');
    } catch { /* backend may be offline */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveUrl = useCallback(async () => {
    const trimmed = apiUrl.trim();
    if (!trimmed) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem(API_URL_KEY, trimmed);
    setSavedUrl(trimmed);
    setSaving(false);
    setConnectionStatus('idle');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [apiUrl]);

  const testConnection = useCallback(async () => {
    setConnectionStatus('testing');
    try {
      const h = await healthApi.get();
      setConnectionStatus('ok');
      setConnectionMsg(`Connected · v${h.version} · ${h.status}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setConnectionStatus('error');
      setConnectionMsg(e.message ?? 'Connection failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  const toggleAutoApprove = useCallback(async (val: boolean) => {
    setAutoApprove(val);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await settingsApi.update({ auto_approve: val ? 'true' : 'false' });
    } catch { setAutoApprove(!val); }
  }, []);

  const urlChanged = apiUrl.trim() !== savedUrl;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} className="active:opacity-60">
            <ArrowLeft size={20} color={C.muted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Settings size={16} color={C.cyan} />
            <Text style={{ color: C.fg, fontSize: 16, fontFamily: 'monospace', fontWeight: '700' }}>SETTINGS</Text>
          </View>
        </View>
      </View>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* API Connection */}
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Cpu size={12} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>Backend Connection</Text>
          </View>

          <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 14 }}>
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', marginBottom: 6 }}>API BASE URL</Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1,
                borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
              }}>
                <TextInput
                  value={apiUrl}
                  onChangeText={setApiUrl}
                  placeholder={DEFAULT_API_URL}
                  placeholderTextColor={C.muted}
                  style={{ flex: 1, color: C.fg, fontSize: 13, fontFamily: 'monospace' }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            </View>

            {/* Connection status */}
            {connectionStatus !== 'idle' && (
              <View style={{
                paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
              }}>
                {connectionStatus === 'testing' && <ActivityIndicator size="small" color={C.cyan} />}
                {connectionStatus === 'ok' && <Wifi size={12} color={C.green} />}
                {connectionStatus === 'error' && <WifiOff size={12} color={C.red} />}
                <Text style={{
                  color: connectionStatus === 'ok' ? C.green : connectionStatus === 'error' ? C.red : C.muted,
                  fontSize: 11, fontFamily: 'monospace',
                }}>
                  {connectionStatus === 'testing' ? 'Testing connection...' : connectionMsg}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: 0 }}>
              <Pressable
                onPress={testConnection}
                disabled={connectionStatus === 'testing'}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: '#0f172a', borderColor: C.border, borderWidth: 1,
                  borderRadius: 8, paddingVertical: 10,
                }}
                className="active:opacity-70"
              >
                {connectionStatus === 'testing'
                  ? <ActivityIndicator size="small" color={C.cyan} />
                  : <RefreshCw size={13} color={C.muted} />
                }
                <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>TEST</Text>
              </Pressable>

              <Pressable
                onPress={saveUrl}
                disabled={!urlChanged || saving}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: urlChanged ? C.cyan + '20' : '#0f172a',
                  borderColor: urlChanged ? C.cyan + '60' : C.border,
                  borderWidth: 1, borderRadius: 8, paddingVertical: 10,
                }}
                className="active:opacity-70"
              >
                {saving ? <ActivityIndicator size="small" color={C.cyan} /> : <Save size={13} color={urlChanged ? C.cyan : C.muted} />}
                <Text style={{ color: urlChanged ? C.cyan : C.muted, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>SAVE</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Workflow Settings */}
        {appSettings && (
          <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Shield size={12} color={C.muted} />
              <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>Workflow Behavior</Text>
            </View>

            <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
              {/* Auto-approve */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
                <View style={{ flex: 1, marginRight: 16 }}>
                  <Text style={{ color: C.fg, fontSize: 13, fontWeight: '600' }}>Auto-Approve Plans</Text>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                    Skip manual review and auto-approve agent execution plans
                  </Text>
                </View>
                <Switch
                  value={autoApprove}
                  onValueChange={toggleAutoApprove}
                  trackColor={{ false: C.border, true: C.cyan + '60' }}
                  thumbColor={autoApprove ? C.cyan : C.slate}
                />
              </View>

              {/* Other settings (read-only display) */}
              {[
                { label: 'Max Concurrent Workflows', value: appSettings.max_concurrent_workflows },
                { label: 'Max ZIP Size', value: `${appSettings.zip_max_size_mb}MB` },
                { label: 'Default Provider', value: appSettings.default_provider },
                { label: 'Default Model', value: appSettings.default_model },
              ].map(({ label, value }) => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
                  <Text style={{ color: C.fg, fontSize: 13 }}>{label}</Text>
                  <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace' }}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* App Info */}
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Info size={12} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>About</Text>
          </View>
          <View style={{ backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}>
            {[
              { label: 'App Version', value: '1.0.1' },
              { label: 'Platform', value: 'Expo SDK 55' },
              { label: 'API Endpoint', value: savedUrl },
            ].map(({ label, value }) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a' }}>
                <Text style={{ color: C.fg, fontSize: 13 }}>{label}</Text>
                <Text style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', maxWidth: 180, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}
