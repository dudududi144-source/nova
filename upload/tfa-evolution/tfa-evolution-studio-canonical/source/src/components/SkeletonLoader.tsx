import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useEffect } from 'react';

function SkeletonBlock({ className }: { className?: string }) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={style}
      className={`bg-secondary rounded-lg ${className ?? ''}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <View className="bg-card border border-border rounded-2xl p-4 gap-3">
      <View className="flex-row items-center justify-between">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-5 w-16" />
      </View>
      <SkeletonBlock className="h-4 w-40" />
      <SkeletonBlock className="h-3 w-28" />
    </View>
  );
}

export function SkeletonRow() {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3 border-b border-border">
      <SkeletonBlock className="h-8 w-8 rounded-full" />
      <View className="flex-1 gap-2">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="h-3 w-20" />
      </View>
      <SkeletonBlock className="h-5 w-16" />
    </View>
  );
}

export function SkeletonStatCard() {
  return (
    <View className="flex-1 bg-card border border-border rounded-2xl p-4 gap-2">
      <SkeletonBlock className="h-3 w-16" />
      <SkeletonBlock className="h-8 w-12" />
    </View>
  );
}
