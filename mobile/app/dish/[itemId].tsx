import { useEffect, useMemo, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import type { ApiDishDetail } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * One dish, and the choices it carries. D-080.
 *
 * ─── The selection is validated twice, and only one of them counts ─────────
 *
 * This screen preselects defaults and disables Add until every required group
 * is satisfied, because being refused after committing is the worst moment to
 * learn a rule. None of it is a guarantee: `addToCart()` re-validates the
 * whole selection server-side against the dish's own groups, and a selection
 * that arrives over HTTP is exactly as trustworthy as anything else a client
 * sends. The UI here is an affordance; the server is the control.
 */
export default function Dish() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { setCart } = useSession();
  const onError = useApiError();
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<ApiDishDetail | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getDish(itemId);
        if (cancelled) return;
        setDetail(loaded);
        // The kitchen's own defaults, preselected — the same shortcut the
        // menu's + takes, made visible so it can be changed.
        setChosen(new Set(
          loaded.modifierGroups.flatMap((group) =>
            group.options.filter((o) => o.isDefault && o.isAvailable).map((o) => o.id)),
        ));
      } catch (failure) {
        if (!cancelled) setError(onError(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [itemId, onError]);

  /** Which required group, if any, has not been answered. */
  const unanswered = useMemo(() => {
    if (!detail) return null;
    return detail.modifierGroups.find((group) => {
      const picked = group.options.filter((o) => chosen.has(o.id)).length;
      return picked < group.minSelections;
    }) ?? null;
  }, [detail, chosen]);

  const total = useMemo(() => {
    if (!detail) return 0;
    const mods = detail.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => chosen.has(o.id))
      .reduce((sum, o) => sum + o.priceDelta.minor, 0);
    return (detail.dish.price.minor + mods) * quantity;
  }, [detail, chosen, quantity]);

  if (error && !detail) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
  if (!detail) return <Loading />;

  const { dish, outlet, modifierGroups } = detail;
  const orderable = dish.isAvailable && outlet.isAcceptingOrders;

  const toggle = (groupId: string, optionId: string, max: number) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      // A single-choice group REPLACES rather than adds. Without this, tapping
      // "Gentle" after "Extra fiery" sends both and the server refuses a
      // selection the screen showed as valid.
      if (max === 1) {
        const group = modifierGroups.find((g) => g.id === groupId);
        for (const option of group?.options ?? []) next.delete(option.id);
      }
      next.add(optionId);
      return next;
    });
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setCart(await api.addToCart({
        menuItemId: dish.id,
        quantity,
        notes: notes.trim() || undefined,
        modifierOptionIds: [...chosen],
      }));
      router.back();
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.name}>{dish.name}</Text>
        <Text style={[s.price, tabular]}>{dish.price.text}</Text>
        {dish.description ? <Text style={s.blurb}>{dish.description}</Text> : null}

        {!orderable ? (
          <Notice>
            {!outlet.isAcceptingOrders
              ? 'The kitchen has stopped taking orders for tonight.'
              : 'This is not available right now.'}
          </Notice>
        ) : null}

        {modifierGroups.map((group) => (
          <View key={group.id} style={s.group}>
            <View style={s.groupHead}>
              <Text style={s.groupName}>{group.name}</Text>
              <Text style={s.groupRule}>
                {group.isRequired
                  ? 'Required'
                  : group.maxSelections > 1 ? `Up to ${group.maxSelections}` : 'Optional'}
              </Text>
            </View>

            {group.options.map((option) => {
              const on = chosen.has(option.id);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked: on, disabled: !option.isAvailable }}
                  disabled={!option.isAvailable}
                  onPress={() => toggle(group.id, option.id, group.maxSelections)}
                  style={({ pressed }) => [
                    s.option,
                    on && s.optionOn,
                    pressed && { backgroundColor: colors.raised },
                    !option.isAvailable && { opacity: 0.4 },
                  ]}
                >
                  <View style={[s.dot, on && s.dotOn]} />
                  <Text style={s.optionName}>{option.name}</Text>
                  {option.priceDelta.minor !== 0 ? (
                    <Text style={[s.optionDelta, tabular]}>
                      {option.priceDelta.minor > 0 ? '+' : ''}{option.priceDelta.text}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={s.group}>
          <Text style={s.groupName}>Anything the kitchen should know</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Less oil, no coriander…"
            placeholderTextColor={colors.inkFaint}
            multiline
            maxLength={280}
            style={s.notes}
            accessibilityLabel="A note for the kitchen"
          />
        </View>

        <View style={s.quantityRow}>
          <Text style={s.groupName}>How many</Text>
          <View style={s.quantityGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One fewer"
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              style={s.quantityStep}
            >
              <Text style={s.quantityText}>−</Text>
            </Pressable>
            <Text style={[s.quantityValue, tabular]}>{quantity}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One more"
              onPress={() => setQuantity((q) => Math.min(20, q + 1))}
              style={s.quantityStep}
            >
              <Text style={s.quantityText}>+</Text>
            </Pressable>
          </View>
        </View>

        {error ? <Notice>{error}</Notice> : null}
      </ScrollView>

      <View style={[s.foot, { paddingBottom: insets.bottom + space[4] }]}>
        {unanswered ? (
          <Text style={s.needs}>Choose {unanswered.name.toLowerCase()} first</Text>
        ) : null}
        <Button
          label="Add to the order"
          trailing={formatFrom(dish.price.text, total)}
          busy={busy}
          disabled={!orderable || Boolean(unanswered)}
          onPress={() => void add()}
        />
      </View>
    </Screen>
  );
}

/**
 * The running total, in the server's own currency format.
 *
 * #5 says format in one place, and that place is the server — but it cannot
 * format a number that only exists while somebody is choosing. So the symbol
 * and the grouping are taken from a string the server DID format, and only the
 * digits are replaced. It is the one place in this app that composes money,
 * and it borrows rather than reimplements.
 */
function formatFrom(sample: string, minor: number): string {
  const symbol = sample.replace(/[\d,.\s]/g, '');
  const major = minor / 100;
  const whole = Number.isInteger(major);
  return `${symbol}${major.toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5] },
  body: { paddingHorizontal: space[5], paddingBottom: space[6], gap: space[4] },

  name: { fontSize: type.xxl, fontWeight: '600', color: colors.ink, lineHeight: 34 },
  price: { fontSize: type.lg, color: colors.accent, fontWeight: '600' },
  blurb: { fontSize: type.base, lineHeight: 23, color: colors.inkDim },

  group: { gap: space[2], marginTop: space[2] },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupName: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  groupRule: {
    fontSize: type.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: TOUCH_MIN,
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.lineFaint,
  },
  dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  optionName: { flex: 1, fontSize: type.base, color: colors.ink },
  optionDelta: { fontSize: type.sm, color: colors.inkDim },

  notes: {
    minHeight: 80,
    padding: space[3],
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.ink,
    fontSize: type.base,
    textAlignVertical: 'top',
  },

  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[2],
  },
  quantityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quantityStep: { width: TOUCH_MIN, height: TOUCH_MIN, alignItems: 'center', justifyContent: 'center' },
  quantityText: { fontSize: type.lg, color: colors.ink },
  quantityValue: { minWidth: 28, textAlign: 'center', fontSize: type.base, fontWeight: '700', color: colors.ink },

  foot: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  needs: { fontSize: type.sm, color: colors.attention, textAlign: 'center' },
});
