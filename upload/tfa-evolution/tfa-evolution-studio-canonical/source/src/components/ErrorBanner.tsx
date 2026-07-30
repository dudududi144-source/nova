import { View, Text, Pressable } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { C } from '@/lib/design';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: C.red + '12', borderBottomWidth: 1, borderBottomColor: C.red + '30',
      paddingHorizontal: 16, paddingVertical: 10,
    }}>
      <AlertTriangle size={14} color={C.red} />
      <Text style={{ color: C.red, fontSize: 12, flex: 1, lineHeight: 16 }}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} className="active:opacity-60">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderColor: C.red + '50', borderWidth: 1, borderRadius: 6 }}>
            <RefreshCw size={11} color={C.red} />
            <Text style={{ color: C.red, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>RETRY</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
