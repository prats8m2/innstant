import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Pressable, StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import * as api from '@/lib/api';
import type { ApiDishDetail, ApiModifierGroup } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { tapAdd } from '@/lib/haptics';
import { Button, Notice } from '@/components/ui';
import { DishPhoto } from '@/components/dish-photo';
import { DietMark } from '@/components/diet-mark';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * Choosing a dish, once, for the two places it is done. Phase 1.
 *
 * ─── Why this was lifted out of the screen ─────────────────────────────────
 *
 * The redesign puts modifier selection in a bottom SHEET over the menu, and a
 * sheet cannot be deep-linked to — a link into `/dish/:id` has no menu
 * underneath it to rise over, and arriving at a sheet floating on an empty
 * ground is worse than arriving at a page. So both have to exist: the sheet
 * is the normal way in, and the full screen is what a URL still opens.
 *
 * Two surfaces, one set of rules. The thing that must not fork is the
 * SELECTION — which options start on, what a single-choice group does to its
 * siblings, which required group is still unanswered, and what the running
 * total is. A second copy of that is a sheet that lets somebody add a
 * selection the page would have refused.
 *
 * So the state is a hook and the pieces are two components, and the only
 * thing each surface decides for itself is what it is made of: a `ScrollView`
 * and a footer on the screen, a `BottomSheetScrollView` and a footer inside
 * the sheet. The footer is the same component in both.
 *
 * ─── The selection is validated twice, and only one of them counts ─────────
 *
 * Defaults are preselected and Add is disabled until every required group is
 * satisfied, because being refused after committing is the worst moment to
 * learn a rule. None of it is a guarantee: `addToCart()` re-validates the
 * whole selection server-side, and a selection that arrives over HTTP is
 * exactly as trustworthy as anything else a client sends. This is an
 * affordance; the server is the control.
 */
export interface DishChoice {
  detail: ApiDishDetail | null;
  error: string | null;
  busy: boolean;
  /** The kitchen is open AND the dish is on. Add is dead without it. */
  orderable: boolean;
  chosen: Set<string>;
  toggle: (groupId: string, optionId: string, max: number) => void;
  quantity: number;
  setQuantity: (next: number) => void;
  notes: string;
  setNotes: (next: string) => void;
  /** The first required group with too few picks, or null. */
  unanswered: ApiModifierGroup | null;
  /** Line total, formatted in the server's own currency format. */
  totalText: string;
  add: () => Promise<void>;
}

export function useDishChoice(itemId: string, onAdded: () => void): DishChoice {
  const { setCart } = useSession();
  const onError = useApiError();

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

  const toggle = useCallback((groupId: string, optionId: string, max: number) => {
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
        const group = detail?.modifierGroups.find((g) => g.id === groupId);
        for (const option of group?.options ?? []) next.delete(option.id);
      }
      next.add(optionId);
      return next;
    });
  }, [detail]);

  const unanswered = useMemo(() => {
    if (!detail) return null;
    return detail.modifierGroups.find((group) => {
      const picked = group.options.filter((o) => chosen.has(o.id)).length;
      return picked < group.minSelections;
    }) ?? null;
  }, [detail, chosen]);

  const totalText = useMemo(() => {
    if (!detail) return '';
    const mods = detail.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => chosen.has(o.id))
      .reduce((sum, o) => sum + o.priceDelta.minor, 0);
    return formatFrom(detail.dish.price.text, (detail.dish.price.minor + mods) * quantity);
  }, [detail, chosen, quantity]);

  const add = useCallback(async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setCart(await api.addToCart({
        menuItemId: detail.dish.id,
        quantity,
        notes: notes.trim() || undefined,
        modifierOptionIds: [...chosen],
      }));
      // After the round trip, not on the tap: the buzz means it is in the
      // cart, and a tap that was refused must not feel like one that worked.
      tapAdd();
      onAdded();
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setBusy(false);
    }
  }, [detail, quantity, notes, chosen, setCart, onError, onAdded]);

  return {
    detail,
    error,
    busy,
    orderable: Boolean(detail && detail.dish.isAvailable && detail.outlet.isAcceptingOrders),
    chosen,
    toggle,
    quantity,
    setQuantity,
    notes,
    setNotes,
    unanswered,
    totalText,
    add,
  };
}

/**
 * Everything that scrolls: the dish, its groups, and the note field.
 *
 * `Input` is a parameter because a `TextInput` inside a bottom sheet has to be
 * the sheet's own — a plain one is covered by the keyboard it raises, because
 * the sheet is the thing that has to move and it only knows to when the field
 * is one of its children.
 */
export function DishChoiceBody({
  choice,
  Input = TextInput,
  showPhoto = true,
}: {
  choice: DishChoice;
  Input?: ComponentType<TextInputProps>;
  /** False on the dish SCREEN, where the same photograph is already the
   *  full-bleed header above this. Two of it on one screen is the app
   *  showing somebody the picture twice. */
  showPhoto?: boolean;
}) {
  const { detail, chosen, toggle, notes, setNotes, orderable } = choice;
  if (!detail) return null;
  const { dish, outlet, modifierGroups } = detail;

  return (
    <>
      <View style={s.head}>
        <View style={s.headText}>
          {/* The legal mark, at the top of the column it is scanned in —
              the same place the menu row puts it. */}
          <DietMark flags={dish.dietaryFlags} size={16} />
          <Text style={s.name}>{dish.name}</Text>
          <Text style={[s.price, tabular]}>{dish.price.text}</Text>
        </View>
        {/* The same photograph the row that was tapped is showing, so the
            sheet rises out of something rather than replacing it. */}
        {showPhoto && dish.imageUrl ? (
          <DishPhoto uri={dish.imageUrl} blurhash={dish.blurhash} name={dish.name} size={84} />
        ) : null}
      </View>

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
        <Input
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

      {choice.error ? <Notice>{choice.error}</Notice> : null}
    </>
  );
}

/**
 * The quantity, the running total and the button — pinned, on both surfaces.
 *
 * The quantity used to be the last row of the scroll, which on a dish with
 * three option groups meant scrolling past the choices to change it and
 * scrolling back to see what it cost. Everything that is a NUMBER about this
 * order now sits in the same place, under a thumb, and the total above it
 * moves while the choices do.
 */
export function DishChoiceFooter({ choice }: { choice: DishChoice }) {
  const { quantity, setQuantity, unanswered, orderable, busy, totalText, add } = choice;

  return (
    <>
      {unanswered ? (
        <Text style={s.needs}>Choose {unanswered.name.toLowerCase()} first</Text>
      ) : null}

      <View style={s.footRow}>
        <View style={s.quantityGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="One fewer"
            onPress={() => setQuantity(Math.max(1, quantity - 1))}
            style={({ pressed }) => [s.quantityStep, pressed && { backgroundColor: colors.raised }]}
          >
            <Text style={s.quantityText}>−</Text>
          </Pressable>
          <Text style={[s.quantityValue, tabular]} accessibilityLiveRegion="polite">{quantity}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="One more"
            onPress={() => setQuantity(Math.min(20, quantity + 1))}
            style={({ pressed }) => [s.quantityStep, pressed && { backgroundColor: colors.raised }]}
          >
            <Text style={s.quantityText}>+</Text>
          </Pressable>
        </View>

        <View style={s.addSlot}>
          <Button
            label="Add"
            trailing={totalText}
            busy={busy}
            disabled={!orderable || Boolean(unanswered)}
            onPress={() => void add()}
          />
        </View>
      </View>
    </>
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
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[4] },
  headText: { flex: 1, gap: space[1] },
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

  needs: { fontSize: type.sm, color: colors.attention, textAlign: 'center' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  quantityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quantityStep: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityText: { fontSize: type.lg, color: colors.ink },
  quantityValue: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: type.base,
    fontWeight: '700',
    color: colors.ink,
  },
  addSlot: { flex: 1 },
});
