import { View, Text } from 'react-native';
import { stateColor } from '@/lib/design';

export type WorkflowState = string;

const STATE_LABEL: Record<string, string> = {
  uploaded:               'UPLOADED',
  extracting:             'EXTRACTING',
  analyzing:              'ANALYZING',
  architecture_generated: 'ARCH',
  plan_generated:         'PLANNED',
  awaiting_approval:      'APPROVAL',
  approved:               'APPROVED',
  executing_agents:       'EXECUTING',
  qa_running:             'QA',
  security_scanning:      'SECURITY',
  packaging:              'PACKAGING',
  ready_for_download:     'READY',
  completed:              'DONE',
  failed:                 'FAILED',
  rejected:               'REJECTED',
};

interface StateBadgeProps {
  state: WorkflowState;
  size?: 'sm' | 'md';
}

export function StateBadge({ state, size = 'sm' }: StateBadgeProps) {
  const color = stateColor(state);
  const label = STATE_LABEL[state] ?? state.toUpperCase().slice(0, 10);
  return (
    <View style={{
      backgroundColor: color + '18',
      borderColor: color + '50',
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: size === 'md' ? 8 : 6,
      paddingVertical: size === 'md' ? 3 : 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{
        color, fontSize: size === 'md' ? 10 : 9,
        fontFamily: 'monospace', fontWeight: '700', letterSpacing: 0.5,
      }}>
        {label}
      </Text>
    </View>
  );
}
