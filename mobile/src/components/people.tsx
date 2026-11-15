// Groups, like the website: the + asks what to start (a tab or a group), New group, and the "Add people" popup
// that lists your friends, filters as you type a name, and takes any email. An email with an account joins straight
// away; anyone else gets an invite email (the server decides).
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Avatar, Btn, Err, Field, Icon, Label, MenuRow, Rows, Sheet, T, Tap } from "@/components/ui";
import { authed } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export type Friend = { id: number; name: string; email: string };
export type Pick = { name: string; friend_id?: number; email?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyOf = (p: Pick) => (p.email ? `e:${p.email}` : `f:${p.friend_id}`);
export const myFriends = () => authed<{ friends: Friend[] }>("GET", "/api/friends").then((r) => r.friends).catch(() => [] as Friend[]);

// Mount it with a new key each time it opens, so it starts from what's chosen so far.
export function PeopleSheet({ open, onClose, friends, taken = [], chosen = [], onDone }: {
  open: boolean; onClose: () => void; friends: Friend[]; taken?: string[]; chosen?: Pick[]; onDone: (picked: Pick[]) => void;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Pick[]>(chosen);
  const has = (p: Pick) => picked.some((x) => keyOf(x) === keyOf(p));
  const toggle = (p: Pick) => setPicked((now) => (now.some((x) => keyOf(x) === keyOf(p)) ? now.filter((x) => keyOf(x) !== keyOf(p)) : [...now, p]));
  const free = friends.filter((f) => !taken.includes(f.name));
  const s = q.trim().toLowerCase();
  const typedEmail = EMAIL_RE.test(s) && !free.some((f) => f.email.toLowerCase() === s) ? { name: s, email: s } : null;
  const addEmail = () => { if (typedEmail) { if (!has(typedEmail)) toggle(typedEmail); setQ(""); } };

  const row = (p: Pick, sub: string, mail: boolean) => {
    const on = has(p);
    return (
      <Tap key={keyOf(p)} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { toggle(p); if (p.email) setQ(""); }}
        className="flex-row items-center gap-3 px-4 py-3" style={{ backgroundColor: on ? "#1c1a17" : colors.surface }}>
        {mail ? <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-2"><Icon.Mail color={colors.text} size={16} /></View> : <Avatar name={p.name} />}
        <View className="flex-1 gap-0.5">
          <T className="text-[15px] font-medium" numberOfLines={1}>{p.name}</T>
          <T className="text-xs text-muted" numberOfLines={1}>{sub}</T>
        </View>
        {on ? <Icon.Check color={colors.accent} size={18} /> : <Icon.Plus color={colors.dim} size={18} />}
      </Tap>
    );
  };
  const rows = [
    ...(typedEmail && !has(typedEmail) ? [row(typedEmail, "Add by email", true)] : []),
    ...picked.filter((p) => p.email).map((p) => row(p, "Joins if they're on EvenUp, or gets an invite email", true)),
    ...free.filter((f) => !s || f.name.toLowerCase().includes(s) || f.email.toLowerCase().includes(s))
      .map((f) => row({ name: f.name, friend_id: f.id }, f.email, false)),
  ];
  const n = picked.length;
  return (
    <Sheet open={open} onClose={onClose} title="Add people"
      footer={<Btn variant="ink" className="flex-1" disabled={!n} title={n ? `Add ${n} ${n === 1 ? "person" : "people"}` : "Add people"}
        onPress={() => { onDone(picked); onClose(); }} />}>
      <Field value={q} onChangeText={setQ} onSubmitEditing={addEmail} placeholder="Search friends or type an email"
        autoCapitalize="none" autoCorrect={false} returnKeyType="done" submitBehavior="submit" />
      {rows.length ? <Rows>{rows}</Rows> : (
        <T className="text-sm leading-5 text-muted">
          {s ? `No friend matches "${q.trim()}". Type their email to add them.` : "Type an email to add someone. Your friends show up here."}
        </T>
      )}
    </Sheet>
  );
}

// The + when you're signed in: a tab or a group, then New group.
export function NewFlow({ step, setStep }: { step: "new" | "group" | null; setStep: (s: "new" | "group" | null) => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<Pick[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [picking, setPicking] = useState(0); // >0: the people popup is open, keyed so it starts fresh
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const startGroup = () => {
    setStep(null);
    setName(""); setPeople([]); setError("");
    myFriends().then(setFriends);
    setTimeout(() => setStep("group"), 350); // one sheet slides out before the next slides in
  };
  const create = async () => {
    setError("");
    if (!name.trim()) return setError("Give the group a name.");
    setBusy(true);
    try {
      const { slug } = await authed<{ slug: string }>("POST", "/api/groups", {
        name: name.trim(),
        friend_ids: people.filter((p) => p.friend_id).map((p) => p.friend_id),
        emails: people.filter((p) => p.email).map((p) => p.email),
      });
      setStep(null);
      router.push(`/g/${slug}`);
    } catch (err) {
      setError((err as { status?: number }).status === 422 ? "One of those emails doesn't look right." : (err as Error).message);
    }
    setBusy(false);
  };

  return (
    <>
      <Sheet open={step === "new"} onClose={() => setStep(null)} title="New">
        <Rows>
          <MenuRow icon={Icon.Receipt} title="Tab" sub="One trip or dinner. Closes on its own" onPress={() => { setStep(null); router.push("/new"); }} />
          <MenuRow icon={Icon.Users} title="Group" sub="People you split with often. Never expires" onPress={startGroup} />
        </Rows>
      </Sheet>
      <Sheet open={step === "group"} onClose={() => setStep(null)} title="New group"
        footer={<Btn variant="ink" className="flex-1" title="Create group" busy={busy} onPress={create} />}
        overlay={picking ? <PeopleSheet key={picking} open onClose={() => setPicking(0)} friends={friends} chosen={people} onDone={setPeople} /> : null}>
        <T className="text-[13px] leading-5 text-muted">For people you split with again and again: a flat, a team, a family. Groups don't expire.</T>
        <View className="gap-2.5">
          <Label>Name</Label>
          <Field value={name} onChangeText={setName} maxLength={40} placeholder="Flat 4B, Goa crew, Office lunch" autoCapitalize="words" />
        </View>
        <View className="gap-2.5">
          <Label>People</Label>
          {!!people.length && (
            <View className="flex-row flex-wrap gap-2">
              {people.map((p) => (
                <View key={keyOf(p)} className="h-10 flex-row items-center gap-2 rounded-full border border-line-2 bg-surface-2 pl-1">
                  <Avatar name={p.name} size={30} />
                  <T className="max-w-[180px] text-sm" numberOfLines={1}>{p.name}</T>
                  <Tap accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} onPress={() => setPeople(people.filter((x) => x !== p))}
                    className="h-8 w-8 items-center justify-center">
                    <Icon.X color={colors.muted} size={14} />
                  </Tap>
                </View>
              ))}
            </View>
          )}
          <Btn small title="Add people" icon={<Icon.UserPlus color={colors.text} size={16} />} onPress={() => setPicking((k) => k + 1)} />
        </View>
        <T className="text-xs leading-5 text-dim">Friends and anyone on EvenUp join straight away. Anyone else gets an invite email and joins when they sign up. You can add more people later.</T>
        <Err>{error}</Err>
      </Sheet>
    </>
  );
}
