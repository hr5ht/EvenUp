// The website's design language in React Native: sharp corners, hairlines, mono uppercase labels, one blue accent.
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { cssInterop } from "nativewind";
import { MONO, useTheme } from "@/lib/theme";

// Reanimated's views (entering animations) take className like any other view.
cssInterop(Reanimated.View, { className: "style" });

// Text in the theme's text colour, unless the className gives it another one.
const COLOR = /(^|\s)text-(text|muted|dim|accent|accent-text|ink-text|owe|owed)(\s|$)/;
export function T({ mono, className = "", style, ...props }: TextProps & { mono?: boolean; className?: string }) {
  return <Text className={`${COLOR.test(className) ? "" : "text-text "}${className}`} style={[mono && { fontFamily: MONO }, style]} {...props} />;
}

// Pressable that dims while held. Plain styles only: a style function drops the className styles.
export function Tap({ style, onPressIn, onPressOut, ...props }: Omit<PressableProps, "style"> & { className?: string; style?: StyleProp<ViewStyle> }) {
  const [down, setDown] = useState(false);
  return (
    <Pressable
      {...props}
      onPressIn={(e) => { setDown(true); onPressIn?.(e); }}
      onPressOut={(e) => { setDown(false); onPressOut?.(e); }}
      style={[style, down && { opacity: 0.7 }]}
    />
  );
}

// [ LABEL ] in mono caps, like the site's .tag / label.
export const Label = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <T mono className={`text-[11px] uppercase tracking-[1px] text-muted ${className}`}>{children}</T>
);

export function Tag({ children, live, className = "" }: { children: ReactNode; live?: boolean; className?: string }) {
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      <T mono className="text-[11px] text-dim">[</T>
      {live && <Animated.View className="h-1.5 w-1.5 bg-owed" style={{ opacity: pulse }} />}
      <T mono className={`text-[11px] uppercase tracking-[1px] ${live ? "text-owed" : "text-muted"}`}>{children}</T>
      <T mono className="text-[11px] text-dim">]</T>
    </View>
  );
}

type BtnProps = {
  title: string; onPress?: () => void; variant?: "ink" | "accent" | "plain" | "danger" | "dashed";
  small?: boolean; disabled?: boolean; busy?: boolean; className?: string; icon?: ReactNode;
};
export function Btn({ title, onPress, variant = "plain", small, disabled, busy, className = "", icon }: BtnProps) {
  const { colors } = useTheme();
  const box = {
    ink: "bg-ink border-ink", accent: "bg-accent border-accent", plain: "bg-surface border-line-2",
    danger: "bg-surface border-owe", dashed: "bg-transparent border-line-2 border-dashed",
  }[variant];
  const text = { ink: "text-ink-text", accent: "text-accent-text", plain: "text-text", danger: "text-owe", dashed: "text-text" }[variant];
  const spin = { ink: colors["ink-text"], accent: colors["accent-text"], plain: colors.text, danger: colors.owe, dashed: colors.text }[variant];
  return (
    <Tap
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={`flex-row items-center justify-center gap-2.5 border ${small ? "h-10 px-3.5" : "h-[52px] px-5"} ${box} ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {busy ? <ActivityIndicator color={spin} /> : icon}
      <T className={`${small ? "text-[13px]" : "text-base"} font-semibold ${text}`}>{title}</T>
    </Tap>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { className?: string }>(function Field({ className = "", ...props }, ref) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.dim}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className={`h-12 border bg-surface px-3.5 text-base text-text ${focus ? "border-text" : "border-line-2"} ${className}`}
      {...props}
    />
  );
});

export const Err = ({ children }: { children?: string }) => (children ? <T className="text-sm text-owe">{children}</T> : null);

// Hairline-joined rows: 1px gaps over the line colour, like the site's .cells grids.
export const Rows = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <View className={`gap-px border border-line bg-line ${className}`}>{children}</View>
);

// Bottom sheet: the site's dialog.sheet on phones.
export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable accessibilityLabel="Close" onPress={onClose} className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} />
        <View className="max-h-[90%] border-t border-text bg-bg" style={{ paddingBottom: insets.bottom }}>
          <View className="flex-row items-center justify-between border-b border-line pl-5 pr-2">
            <T className="flex-1 py-4 text-xl font-bold tracking-tight" numberOfLines={1}>{title}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-11 w-11 items-center justify-center">
              <Icon.X color={colors.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-5">{children}</ScrollView>
          {footer && <View className="flex-row gap-2.5 border-t border-line px-5 py-3">{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// "Added Dinner · Undo" at the bottom, gone after 5s.
export type ToastMsg = { text: string; action?: string; onAction?: () => void } | null;
export function Toast({ msg, onDone }: { msg: ToastMsg; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { dark } = useTheme();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <View pointerEvents="box-none" className="absolute left-4 right-4" style={{ bottom: insets.bottom + 90 }}>
      <View className="flex-row items-center justify-between gap-3 bg-ink px-4 py-3">
        <T className="flex-1 text-sm text-ink-text">{msg.text}</T>
        {msg.action && (
          <Pressable accessibilityRole="button" onPress={() => { onDone(); msg.onAction?.(); }} hitSlop={10}>
            <T className="text-sm font-semibold" style={{ color: dark ? "#2b4bff" : "#8fa2ff" }}>{msg.action}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Logo() {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-2.5">
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Rect width={22} height={22} fill={colors.ink} />
        <Rect x={11} width={11} height={11} fill={colors.accent} />
      </Svg>
      <T className="text-lg font-bold tracking-tight">QuickTab</T>
    </View>
  );
}

// Stroke icons, same shapes as the website's.
type IconProps = { color: string; size?: number };
const stroke = (color: string) => ({ fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "square" as const });
const svg = (draw: (p: ReturnType<typeof stroke>) => ReactNode) =>
  function StrokeIcon({ color, size = 20 }: IconProps) {
    return <Svg width={size} height={size} viewBox="0 0 24 24">{draw(stroke(color))}</Svg>;
  };
export const Icon = {
  Back: svg((p) => <Path d="M15 5l-7 7 7 7" {...p} />),
  X: svg((p) => <Path d="M6 6l12 12M18 6L6 18" {...p} />),
  Plus: svg((p) => <Path d="M12 4v16M4 12h16" {...p} />),
  Arrow: svg((p) => <Path d="M4 12h15M13 6l6 6-6 6" {...p} />),
  Check: svg((p) => <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />),
  Chart: svg((p) => <Path d="M3 3v18h18M8 17v-4M13 17V9M18 17V5" {...p} />),
  Share: svg((p) => <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" {...p} />),
  Clock: svg((p) => <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M12 7v5l3 2" {...p} /></>),
  Shield: svg((p) => <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p} />),
  Moon: svg((p) => <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" {...p} />),
  Sun: svg((p) => <><Circle cx={12} cy={12} r={4} {...p} /><Path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} /></>),
  Link: svg((p) => <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...p} />),
  Lock: svg((p) => <><Rect x={5} y={11} width={14} height={10} {...p} /><Path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} /></>),
};

export function ThemeButton() {
  const { colors, dark, toggle } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Switch light or dark theme" onPress={toggle}
      className="h-10 w-10 items-center justify-center border border-line-2 bg-surface">
      {dark ? <Icon.Sun color={colors.text} size={18} /> : <Icon.Moon color={colors.text} size={18} />}
    </Pressable>
  );
}

// Rolls a number to its new value instead of jumping, like the site's countUp. A new key (another person) starts from 0.
export function useCountUp(value: number, key: unknown, ms = 700) {
  const [shown, setShown] = useState(value);
  const last = useRef({ value: 0, key: undefined as unknown });
  useEffect(() => {
    const a = last.current.key === key ? last.current.value : 0;
    last.current = { value, key };
    if (a === value) return setShown(value);
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      setShown(Math.round(a + (value - a) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, key, ms]);
  return shown;
}
