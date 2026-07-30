import { View, Text } from 'react-native';

interface StatCardProps {
  label: string;
  value: string | number;
  color?: 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'slate';
  icon?: React.ReactNode;
}

const COLOR_MAP = {
  blue: 'text-blue-400',
  amber: 'text-amber-400',
  green: 'text-green-400',
  red: 'text-red-400',
  purple: 'text-purple-400',
  slate: 'text-slate-400',
};

export function StatCard({ label, value, color = 'blue', icon }: StatCardProps) {
  const textColor = COLOR_MAP[color];
  return (
    <View className="flex-1 bg-card border border-border rounded-2xl p-4 gap-2" style={{ borderCurve: 'continuous' }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</Text>
        {icon}
      </View>
      <Text className={`text-3xl font-bold font-mono ${textColor}`}>{value}</Text>
    </View>
  );
}
