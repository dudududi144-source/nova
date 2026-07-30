import { View, Text, Pressable } from 'react-native';
import { C } from '@/lib/design';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 8 }}>
      {icon && (
        <View style={{ width: 60, height: 60, borderRadius: 15, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          {icon}
        </View>
      )}
      <Text style={{ color: C.fg, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      {description && (
        <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>{description}</Text>
      )}
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={{ marginTop: 8, backgroundColor: C.cyan, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 }}
          className="active:opacity-80"
        >
          <Text style={{ color: C.bg, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
