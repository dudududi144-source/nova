import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutDashboard, Crosshair, Hammer, FlaskConical, Archive } from 'lucide-react-native';

const ACTIVE_COLOR = '#06b6d4';
const INACTIVE_COLOR = '#475569';
const TAB_BG = '#080c14';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarStyle: {
          backgroundColor: TAB_BG,
          borderTopColor: '#1e293b',
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="missions"
        options={{
          title: 'Missions',
          tabBarIcon: ({ color, size }) => <Crosshair size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="forge"
        options={{
          title: 'Forge',
          tabBarIcon: ({ color, size }) => <Hammer size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="lab"
        options={{
          title: 'Lab',
          tabBarIcon: ({ color, size }) => <FlaskConical size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: 'Vault',
          tabBarIcon: ({ color, size }) => <Archive size={size} color={color} />,
        }}
      />
      {/* Hide pipeline from tab bar - kept as fallback route */}
      <Tabs.Screen
        name="pipeline"
        options={{ href: null, title: 'Pipeline' }}
      />
    </Tabs>
  );
}
