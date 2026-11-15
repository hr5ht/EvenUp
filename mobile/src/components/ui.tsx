// The website's design language in React Native: near-black, round pills, hairlines, Instrument Serif titles, one brass accent.
import { Children, Fragment, isValidElement, type ComponentProps, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  Easing, FadeIn, FadeInDown, FadeOutDown, Keyframe, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { FONTS, MONO, useTheme } from "@/lib/theme";

// Entering animation around classed content. Reanimated's view is never registered with NativeWind: on Android the
// interop dropped its style (see-through sheets, no backdrop). So the animated view only animates, and the classes
// sit on a plain View inside it.
export function Anim({ className, children, ...props }: Omit<ComponentProps<typeof Reanimated.View>, "children"> & { className?: string; children?: ReactNode }) {
  return <Reanimated.View {...props}>{className ? <View className={className}>{children}</View> : children}</Reanimated.View>;
}

// Text in the theme's text colour, unless the className gives it another one. The weight picks the font, as on the
// site: font-bold is a title or a big amount, so Instrument Serif; the rest is Instrument Sans at its own weight.
const COLOR = /(^|\s)text-(text|muted|dim|accent|accent-text|ink-text|owe|owed|paper-ink|paper-2|pos-p|neg-p)(\s|$)/;
export const fontOf = (className: string, mono?: boolean) =>
  mono ? MONO : /(^|\s)font-bold/.test(className) ? FONTS.serif : /(^|\s)font-semibold/.test(className) ? FONTS.semibold
    : /(^|\s)font-medium/.test(className) ? FONTS.medium : FONTS.sans;
export function T({ mono, className = "", style, ...props }: TextProps & { mono?: boolean; className?: string }) {
  // fontWeight normal: each weight is its own font file, and a synthesized bold on top would smear it.
  return <Text className={`${COLOR.test(className) ? "" : "text-text "}${className}`}
    style={[{ fontFamily: fontOf(className, mono), fontWeight: "normal" }, style]} {...props} />;
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

// A quiet sentence-case label, like the site's form labels. Old "[ LABEL ]" strings lose their brackets.
export const Label = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <T className={`text-[13px] text-muted ${className}`}>{typeof children === "string" ? children.replace(/^\[\s*|\s*\]$/g, "") : children}</T>
);

export function Tag({ children, live, className = "" }: { children: ReactNode; live?: boolean; className?: string }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (live) pulse.value = withRepeat(withTiming(0.3, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [live, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  // A small pill, like the site's .tag: green with a breathing dot while live, a hairline outline once closed.
  return (
    <View className={`h-[22px] flex-row items-center gap-1.5 self-start rounded-full border px-2.5 ${live ? "" : "border-line-2"} ${className}`}
      style={live ? { borderColor: "rgba(95,211,155,0.25)", backgroundColor: "rgba(95,211,155,0.08)" } : undefined}>
      {live && <Reanimated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.owed }, dot]} />}
      <T mono className={`text-[11px] ${live ? "text-owed" : "text-muted"}`}>{children}</T>
    </View>
  );
}

type BtnProps = {
  title: string; onPress?: () => void; variant?: "ink" | "accent" | "plain" | "danger" | "dangerFill" | "dashed";
  small?: boolean; disabled?: boolean; busy?: boolean; className?: string; icon?: ReactNode;
};
export function Btn({ title, onPress, variant = "plain", small, disabled, busy, className = "", icon }: BtnProps) {
  const { colors } = useTheme();
  // The site's pills: the main action white with dark text ("accent" too: brass is for details, never a button),
  // the rest a faint fill with a hairline.
  const box = {
    ink: "bg-ink border-ink", accent: "bg-ink border-ink", plain: "bg-surface-2 border-line-2",
    danger: "bg-surface-2 border-owe", dangerFill: "bg-owe border-owe", dashed: "bg-transparent border-line-2 border-dashed",
  }[variant];
  const text = { ink: "text-ink-text", accent: "text-ink-text", plain: "text-text", danger: "text-owe", dangerFill: "text-ink-text", dashed: "text-text" }[variant];
  const spin = { ink: colors["ink-text"], accent: colors["ink-text"], plain: colors.text, danger: colors.owe, dangerFill: colors["ink-text"], dashed: colors.text }[variant];
  return (
    <Tap
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={`flex-row items-center justify-center gap-2 rounded-full border ${/(^|\s)h-/.test(className) ? "" : small ? "h-10" : "h-12"} ${small ? "px-4" : "px-5"} ${box} ${disabled ? "opacity-40" : ""} ${className}`}
    >
      {busy ? <ActivityIndicator color={spin} /> : icon}
      <T numberOfLines={1} className={`${small ? "text-sm" : "text-[15px]"} font-medium ${text}`}>{title}</T>
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
      // Defaults step aside when the className sets its own height, text size, border or side padding, so they never fight.
      className={[
        !/(^|\s)h-/.test(className) && "h-12",
        !/(^|\s)text-\[|(^|\s)text-(xs|sm|base|lg|xl|\dxl)/.test(className) && "text-base",
        !/(^|\s)border-0/.test(className) && `rounded-xl border ${focus ? "border-accent" : "border-line-2"}`,
        !/(^|\s)px-/.test(className) && "px-4",
        "bg-surface text-text", className,
      ].filter(Boolean).join(" ")}
      {...props}
      style={[{ fontFamily: fontOf(className), fontWeight: "normal" }, props.style]}
    />
  );
}

// The site's switch: a pill with a round knob that slides across, brass when on.
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors } = useTheme();
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => { x.value = withTiming(value ? 1 : 0, { duration: 220, easing: EASE }); }, [value, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 18 }] }));
  return (
    <Tap accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} hitSlop={8}
      style={{ width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: value ? colors.accent : colors["surface-3"] }}>
      <Reanimated.View style={[{ width: 20, height: 20, borderRadius: 10, backgroundColor: value ? colors["accent-text"] : colors.muted }, knob]} />
    </Tap>
  );
}

export const Err = ({ children }: { children?: string }) => (children ? <T className="text-sm text-owe">{children}</T> : null);

// Rows joined by hairlines in one rounded card, like the site's lists.
export const Rows = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <View className={`gap-px overflow-hidden rounded-[20px] border border-line bg-line ${className}`}>{children}</View>
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
  const { colors, vars } = useTheme();
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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end" style={vars}>
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.65)" }, backdrop]}>
          <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1" />
        </Reanimated.View>
        <Reanimated.View style={[{ maxHeight: "90%", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0,
          borderColor: colors["line-2"], backgroundColor: colors.surface, paddingBottom: insets.bottom }, panel]}>
          <View {...pan.panHandlers}>
            <View className="items-center pt-2.5"><View className="h-1 w-10 rounded-full bg-surface-3" /></View>
            <View className="flex-row items-center justify-between pb-2 pl-5 pr-3 pt-2">
              <View className="flex-1 gap-1">
                {kicker && <Label className="text-accent">{kicker}</Label>}
                <T className="text-[28px] font-bold leading-8" numberOfLines={1}>{title}</T>
              </View>
              <Tap accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border border-line-2 bg-surface-2">
                <Icon.X color={colors.text} size={18} />
              </Tap>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-5">
            {flatten(children).map((child, i) => (
              <Reanimated.View key={i} entering={rise(i)}>{child}</Reanimated.View>
            ))}
          </ScrollView>
          {footer && (
            <Anim entering={FadeIn.delay(200).duration(300)} className="flex-row gap-2.5 border-t border-line px-5 py-3">{footer}</Anim>
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
  const { vars, colors } = useTheme();
  const [req, setReq] = useState<Ask | null>(null);
  const ask = (title: string, text: string, ok: string) => new Promise<boolean>((resolve) => setReq({ title, text, ok, resolve }));
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  const el = req && (
    <Modal visible transparent animationType="none" onRequestClose={() => done(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-6" style={vars}>
        <Reanimated.View entering={FadeIn.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.65)" }]}>
          <Pressable accessibilityLabel="Cancel" onPress={() => done(false)} className="flex-1" />
        </Reanimated.View>
        <Reanimated.View entering={popIn} style={{ width: "100%", maxWidth: 400, borderRadius: 24, borderWidth: 1, borderColor: colors["line-2"], backgroundColor: colors.surface }}>
          <View className="gap-2 p-6 pb-4">
            <T className="text-[26px] font-bold leading-8">{req.title}</T>
            <T className="text-sm leading-5 text-muted">{req.text}</T>
          </View>
          <View className="flex-row gap-2.5 px-6 pb-6">
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
  const { colors } = useTheme();
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
        <Reanimated.View key={msg.text} entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(200)}
          style={{ overflow: "hidden", borderRadius: 18, backgroundColor: colors.ink, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 }}>
          <View className="flex-row items-center gap-3 px-4 py-3.5">
            <View className={`h-5 w-5 items-center justify-center rounded-full ${msg.error ? "bg-owe" : "bg-owed"}`}>
              {msg.error ? <T className="text-xs font-semibold text-ink-text">!</T> : <Icon.Check color={colors["ink-text"]} size={13} />}
            </View>
            <T className="flex-1 text-sm text-ink-text">{msg.text}</T>
            {msg.action && (
              <Tap accessibilityRole="button" onPress={() => { onDone(); msg.onAction?.(); }} hitSlop={10}>
                <T className="text-sm font-semibold" style={{ color: "#8a6a35" }}>{msg.action}</T>
              </Tap>
            )}
          </View>
          <Reanimated.View style={[{ height: 2, backgroundColor: msg.error ? colors.owe : colors["paper-2"], transformOrigin: "left" }, bar]} />
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
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-2">{icon({ color: colors.accent, size: 18 })}</View>
      <View className="flex-1 gap-0.5">
        <T className="text-[15px] font-semibold">{title}</T>
        {sub && <T className="text-xs leading-4 text-muted">{sub}</T>}
      </View>
      <Icon.Chev color={colors.dim} size={16} />
    </Tap>
  );
}

export function Logo() {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-2.5">
      {/* The site's mark: a little receipt with two printed lines and a torn foot. */}
      <Svg width={22} height={26} viewBox="0 0 22 26">
        <Path d="M0 4a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v22l-2.75-2.2-2.75 2.2-2.75-2.2-2.75 2.2-2.75-2.2-2.75 2.2-2.75-2.2L0 26z" fill={colors.ink} />
        <Rect x={5} y={7} width={12} height={2} rx={1} fill={colors.bg} />
        <Rect x={5} y={12} width={8} height={2} rx={1} fill={colors.bg} />
      </Svg>
      <T className="text-[17px] font-semibold">EvenUp</T>
    </View>
  );
}

// Stroke icons, same shapes as the website's.
type IconProps = { color: string; size?: number };
const stroke = (color: string) => ({ fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });
const svg = (draw: (p: ReturnType<typeof stroke>) => ReactNode) =>
  function StrokeIcon({ color, size = 20 }: IconProps) {
    return <Svg width={size} height={size} viewBox="0 0 24 24">{draw(stroke(color))}</Svg>;
  };
export const Icon = {
  Back: svg((p) => <Path d="M15 5l-7 7 7 7" {...p} />),
  Chev: svg((p) => <Path d="M9 6l6 6-6 6" {...p} />),
  Down: svg((p) => <Path d="M6 9l6 6 6-6" {...p} />),
  Home: svg((p) => <Path d="M4 10.5L12 4l8 6.5V20h-5v-6h-6v6H4z" {...p} />),
  User: svg((p) => <><Circle cx={12} cy={8} r={4} {...p} /><Path d="M4 21a8 8 0 0 1 16 0" {...p} /></>),
  Receipt: svg((p) => <Path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21zM9 8h6M9 12h6M9 16h3" {...p} />),
  History: svg((p) => <><Path d="M3 12a9 9 0 1 0 3-6.7L3 8" {...p} /><Path d="M3 3v5h5M12 7v5l3 2" {...p} /></>),
  X: svg((p) => <Path d="M6 6l12 12M18 6L6 18" {...p} />),
  Plus: svg((p) => <Path d="M12 4v16M4 12h16" {...p} />),
  Arrow: svg((p) => <Path d="M4 12h15M13 6l6 6-6 6" {...p} />),
  Check: svg((p) => <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />),
  Chart: svg((p) => <Path d="M3 3v18h18M8 17v-4M13 17V9M18 17V5" {...p} />),
  Share: svg((p) => <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" {...p} />),
  Clock: svg((p) => <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M12 7v5l3 2" {...p} /></>),
  Shield: svg((p) => <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p} />),
  Link: svg((p) => <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...p} />),
  Image: svg((p) => <><Rect x={3} y={4} width={18} height={16} rx={3} {...p} /><Circle cx={9} cy={10} r={1.6} {...p} /><Path d="M21 16l-5-5-9 9" {...p} /></>),
  File: svg((p) => <Path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" {...p} />),
  Cash: svg((p) => <><Rect x={2} y={6} width={20} height={12} rx={2} {...p} /><Circle cx={12} cy={12} r={2.5} {...p} /><Path d="M6 10v4M18 10v4" {...p} /></>),
  Phone: svg((p) => <><Rect x={6} y={2} width={12} height={20} rx={3} {...p} /><Path d="M11 18h2" {...p} /></>),
  Lock: svg((p) => <><Rect x={5} y={11} width={14} height={10} rx={2} {...p} /><Path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} /></>),
};

// A person as a round avatar with their initials, like the site's .avatar.
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export function Avatar({ name, size = 36, paper }: { name: string; size?: number; paper?: boolean }) {
  return (
    <View className={`items-center justify-center rounded-full ${paper ? "bg-[#e2dccf]" : "border border-line-2 bg-surface-2"}`} style={{ width: size, height: size }}>
      <T className={`font-medium ${paper ? "text-paper-ink" : "text-muted"}`} style={{ fontSize: size * 0.36 }}>{initials(name)}</T>
    </View>
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
