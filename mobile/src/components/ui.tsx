// The website's design language in React Native: sharp corners, hairlines, mono uppercase labels, one blue accent.
import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View,
  useWindowDimensions,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  Easing, FadeIn, FadeInDown, FadeOutDown, Keyframe, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from "react-native-reanimated";
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
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (live) pulse.value = withRepeat(withTiming(0.3, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [live, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      <T mono className="text-[11px] text-dim">[</T>
      {live && <Reanimated.View className="h-1.5 w-1.5 bg-owed" style={dot} />}
      <T mono className={`text-[11px] uppercase tracking-[1px] ${live ? "text-owed" : "text-muted"}`}>{children}</T>
      <T mono className="text-[11px] text-dim">]</T>
    </View>
  );
}

type BtnProps = {
  title: string; onPress?: () => void; variant?: "ink" | "accent" | "plain" | "danger" | "dangerFill" | "dashed";
  small?: boolean; disabled?: boolean; busy?: boolean; className?: string; icon?: ReactNode;
};
export function Btn({ title, onPress, variant = "plain", small, disabled, busy, className = "", icon }: BtnProps) {
  const { colors } = useTheme();
  const box = {
    ink: "bg-ink border-ink", accent: "bg-accent border-accent", plain: "bg-surface border-line-2",
    danger: "bg-surface border-owe", dangerFill: "bg-owe border-owe", dashed: "bg-transparent border-line-2 border-dashed",
  }[variant];
  const text = { ink: "text-ink-text", accent: "text-accent-text", plain: "text-text", danger: "text-owe", dangerFill: "text-accent-text", dashed: "text-text" }[variant];
  const spin = { ink: colors["ink-text"], accent: colors["accent-text"], plain: colors.text, danger: colors.owe, dangerFill: "#fff", dashed: colors.text }[variant];
  return (
    <Tap
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={`flex-row items-center justify-center gap-2.5 border ${small ? "h-10 px-3.5" : "h-[52px] px-5"} ${box} ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {busy ? <ActivityIndicator color={spin} /> : icon}
      <T numberOfLines={1} className={`${small ? "text-[13px]" : "text-base"} font-semibold ${text}`}>{title}</T>
    </Tap>
  );
}

export function Field({ className = "", ...props }: TextInputProps & { className?: string }) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.dim}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      // Defaults step aside when the className sets its own height, text size or border, so they never fight.
      className={[
        !/(^|\s)h-/.test(className) && "h-12",
        !/(^|\s)text-\[|(^|\s)text-(xs|sm|base|lg|xl|\dxl)/.test(className) && "text-base",
        !/(^|\s)border-0/.test(className) && `border ${focus ? "border-text" : "border-line-2"}`,
        "bg-surface px-3.5 text-text", className,
      ].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export const Err = ({ children }: { children?: string }) => (children ? <T className="text-sm text-owe">{children}</T> : null);

// Hairline-joined rows: 1px gaps over the line colour, like the site's .cells grids.
export const Rows = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <View className={`gap-px border border-line bg-line ${className}`}>{children}</View>
);

// Children with fragments unpacked, so each piece gets its own spacing and its own place in the stagger.
const flatten = (children: ReactNode): ReactNode[] =>
  Children.toArray(children).flatMap((c) => (isValidElement(c) && c.type === Fragment ? flatten((c.props as { children?: ReactNode }).children) : [c]));

// The site's easing (--ease): quick out, soft landing.
export const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const rise = (i: number) => FadeInDown.delay(110 + Math.min(i, 8) * 45).duration(420).easing(EASE);

// Bottom sheet: the site's dialog.sheet on phones. The backdrop fades while the panel slides up on the site's easing,
// the contents rise in one by one, and a drag down on the header closes it.
export function Sheet({ open, onClose, title, kicker, children, footer, overlay }: {
  open: boolean; onClose: () => void; title: string; kicker?: string; children: ReactNode; footer?: ReactNode;
  overlay?: ReactNode; // another pop-up shown over this one (a confirm), nested so it stacks on every platform
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true); // opening mounts at once; closing waits for the slide out
  const shown = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (open) {
      drag.value = 0;
      shown.value = withTiming(1, { duration: 420, easing: EASE });
      return;
    }
    shown.value = withTiming(0, { duration: 240, easing: Easing.in(Easing.quad) });
    const t = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(t);
  }, [open, shown, drag]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 110 || g.vy > 0.9) onClose();
      else drag.set(withSpring(0, { damping: 20, stiffness: 220 }));
    },
  }), [onClose, drag]);

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.value * (1 - Math.min(drag.value / 400, 0.6)) }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height + drag.value }] }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Reanimated.View className="absolute inset-0" style={[{ backgroundColor: "rgba(5,5,4,0.55)" }, backdrop]}>
          <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1" />
        </Reanimated.View>
        <Reanimated.View className="max-h-[90%] border-t border-line-2 bg-bg" style={[{ paddingBottom: insets.bottom }, panel]}>
          <View {...pan.panHandlers}>
            <View className="items-center pt-2"><View className="h-1 w-9 bg-line-2" /></View>
            <View className="flex-row items-center justify-between border-b border-line pb-3 pl-5 pr-2 pt-1">
              <View className="flex-1 gap-1">
                {kicker && <Label>[ {kicker} ]</Label>}
                <T className="text-[22px] font-bold tracking-tight" numberOfLines={1}>{title}</T>
              </View>
              <Tap accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-11 w-11 items-center justify-center">
                <Icon.X color={colors.text} />
              </Tap>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-5">
            {flatten(children).map((child, i) => (
              <Reanimated.View key={i} entering={rise(i)}>{child}</Reanimated.View>
            ))}
          </ScrollView>
          {footer && (
            <Reanimated.View entering={FadeIn.delay(200).duration(300)} className="flex-row gap-2.5 border-t border-line px-5 py-3">{footer}</Reanimated.View>
          )}
        </Reanimated.View>
        {overlay}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// In-app stand-in for a confirm alert, like the website's: a card that scales in over a fading backdrop.
// const [confirmEl, ask] = useConfirm(); ... if (await ask("Remove Riya?", "…", "Remove")) …
type Ask = { title: string; text: string; ok: string; resolve: (v: boolean) => void };
const popIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.94 }, { translateY: 8 }] },
  100: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }], easing: EASE },
}).duration(260);

export function useConfirm() {
  const [req, setReq] = useState<Ask | null>(null);
  const ask = (title: string, text: string, ok: string) => new Promise<boolean>((resolve) => setReq({ title, text, ok, resolve }));
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  const el = req && (
    <Modal visible transparent animationType="none" onRequestClose={() => done(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-6">
        <Reanimated.View entering={FadeIn.duration(200)} className="absolute inset-0" style={{ backgroundColor: "rgba(5,5,4,0.6)" }}>
          <Pressable accessibilityLabel="Cancel" onPress={() => done(false)} className="flex-1" />
        </Reanimated.View>
        <Reanimated.View entering={popIn} className="w-full max-w-[400px] border border-line-2 bg-bg">
          <View className="gap-2 p-5">
            <Label className="text-owe">[ Confirm ]</Label>
            <T className="text-xl font-bold tracking-tight">{req.title}</T>
            <T className="text-sm leading-5 text-muted">{req.text}</T>
          </View>
          <View className="flex-row gap-2.5 border-t border-line p-4">
            <Btn className="flex-1" title="Cancel" onPress={() => done(false)} />
            <Btn className="flex-1" variant="dangerFill" title={req.ok} onPress={() => done(true)} />
          </View>
        </Reanimated.View>
      </View>
    </Modal>
  );
  return [el, ask] as const;
}

// "Added Dinner · Undo" at the bottom. Springs up, a bar counts down the 5 seconds, then it slides away.
export type ToastMsg = { text: string; action?: string; onAction?: () => void; error?: boolean } | null;
export function Toast({ msg, onDone }: { msg: ToastMsg; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors, dark } = useTheme();
  const left = useSharedValue(1);
  useEffect(() => {
    if (!msg) return;
    left.value = 1;
    left.value = withTiming(0, { duration: 5000, easing: Easing.linear });
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [msg, onDone, left]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: left.value }] }));
  return (
    <View pointerEvents="box-none" className="absolute left-4 right-4" style={{ bottom: insets.bottom + 88 }}>
      {msg && (
        <Reanimated.View key={msg.text} entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(200)} className="bg-ink"
          style={{ shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 }}>
          <View className="flex-row items-center gap-3 px-4 py-3.5">
            <View className={`h-5 w-5 items-center justify-center ${msg.error ? "bg-owe" : "bg-accent"}`}>
              {msg.error ? <T className="text-xs font-bold text-accent-text">!</T> : <Icon.Check color="#fff" size={14} />}
            </View>
            <T className="flex-1 text-sm text-ink-text">{msg.text}</T>
            {msg.action && (
              <Tap accessibilityRole="button" onPress={() => { onDone(); msg.onAction?.(); }} hitSlop={10}>
                <T className="text-sm font-semibold" style={{ color: dark ? "#2b4bff" : "#8fa2ff" }}>{msg.action}</T>
              </Tap>
            )}
          </View>
          <Reanimated.View className="h-0.5" style={[{ backgroundColor: msg.error ? colors.owe : colors.accent, transformOrigin: "left" }, bar]} />
        </Reanimated.View>
      )}
    </View>
  );
}

// A choice in a sheet: icon, title, one line of what it does, and an arrow. Rows stack with hairlines (inside <Rows>).
export function MenuRow({ icon, title, sub, onPress, disabled }: {
  icon: (p: { color: string; size?: number }) => ReactNode; title: string; sub?: string; onPress: () => void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Tap accessibilityRole="button" onPress={onPress} disabled={disabled} className={`min-h-[64px] flex-row items-center gap-3.5 bg-surface px-4 py-3 ${disabled ? "opacity-40" : ""}`}>
      <View className="h-9 w-9 items-center justify-center border border-line bg-bg">{icon({ color: colors.text, size: 18 })}</View>
      <View className="flex-1 gap-0.5">
        <T className="text-[15px] font-semibold">{title}</T>
        {sub && <T className="text-xs leading-4 text-muted">{sub}</T>}
      </View>
      <Icon.Arrow color={colors.dim} size={16} />
    </Tap>
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
  Image: svg((p) => <><Rect x={3} y={4} width={18} height={16} {...p} /><Circle cx={9} cy={10} r={1.6} {...p} /><Path d="M21 16l-5-5-9 9" {...p} /></>),
  File: svg((p) => <Path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" {...p} />),
  Cash: svg((p) => <><Rect x={2} y={6} width={20} height={12} {...p} /><Circle cx={12} cy={12} r={2.5} {...p} /><Path d="M6 10v4M18 10v4" {...p} /></>),
  Phone: svg((p) => <><Rect x={6} y={2} width={12} height={20} {...p} /><Path d="M11 18h2" {...p} /></>),
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
