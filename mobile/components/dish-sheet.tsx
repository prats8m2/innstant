import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DishChoiceBody, DishChoiceFooter, useDishChoice } from '@/components/dish-choice';
import { DishSkeleton } from '@/components/skeleton';
import { colors, radius, space, TOUCH_MIN } from '@/lib/theme';

/**
 * The dish, as a sheet over the menu. Phase 1 of the redesign.
 *
 * ─── What changes, and what deliberately does not ──────────────────────────
 *
 * Choosing a dish used to be a push: the menu left the screen, a page
 * arrived, and coming back was a back arrow. That is the shape of a website,
 * and it loses the context that makes the choice easy — the rest of the menu,
 * and the fact that you are in the middle of ordering rather than reading a
 * product page.
 *
 * The full screen at `/dish/:id` stays, because a sheet cannot be deep-linked
 * to. Both render `DishChoiceBody` and `DishChoiceFooter` over one hook, so
 * there is one set of selection rules and two ways to see them.
 *
 * ─── Why `BottomSheet` and not `BottomSheetModal` ──────────────────────────
 *
 * The modal variant needs a provider mounted above the navigator and renders
 * through a portal, which buys the ability to open a sheet from anywhere in
 * the tree. Nothing needs that: the sheet is opened by the screen that owns
 * it, by a ref, and it is a child of that screen. A provider in the root
 * layout would be a global for a local thing.
 *
 * The cost is that it draws inside its screen rather than over the whole app,
 * so a screen that mounts one puts it LAST — after the cart pill, so the pill
 * is under it rather than floating over it.
 *
 * ─── A fixed height, not a measured one ────────────────────────────────────
 *
 * `enableDynamicSizing` would size the sheet to the dish, which means the
 * sheet changes height the moment the fetch lands — growing under a thumb
 * already on its way to the + button. The height is the sheet's: it opens at
 * 62% of the screen with the skeleton already in it, and a long dish is
 * scrolled, or dragged to the second stop.
 */
export interface DishSheetHandle {
  open: (itemId: string) => void;
}

/** Tall enough for a dish with two option groups without a drag; short
 *  enough that the menu is still legible behind it, which is the point. */
const SNAP = ['62%', '92%'];

/**
 * What the pinned footer takes out of the scroll: the 48pt control row, the
 * 12 above it and the 16 below. The footer floats over the content rather
 * than displacing it, so the last option would otherwise sit under the Add
 * button — reachable only by over-scrolling.
 */
const FOOT_CLEARANCE = TOUCH_MIN + space[3] + space[4];

export const DishSheet = forwardRef<DishSheetHandle, { onAdded?: () => void }>(
  function DishSheet({ onAdded }, ref) {
    /** Null when closed. The sheet is MOUNTED per dish rather than kept at
     *  index -1: its footer has to read the selection, so the hook has to be
     *  above the sheet, and a hook cannot be called for a dish that is not
     *  open. Mounting also guarantees a fresh dish never opens holding the
     *  last one's chosen options. */
    const [itemId, setItemId] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({ open: (id: string) => setItemId(id) }), []);

    if (!itemId) return null;
    return (
      <Open
        key={itemId}
        itemId={itemId}
        onClosed={() => setItemId(null)}
        onAdded={onAdded}
      />
    );
  },
);

function Open({
  itemId,
  onClosed,
  onAdded,
}: {
  itemId: string;
  onClosed: () => void;
  onAdded?: () => void;
}) {
  const sheet = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const choice = useDishChoice(itemId, useCallback(() => {
    sheet.current?.close();
    onAdded?.();
  }, [onAdded]));

  const backdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      // Dark enough to drop the menu behind, light enough that it is still
      // visibly the menu — this is a layer over a place, not a new place.
      opacity={0.6}
      pressBehavior="close"
    />
  ), []);

  /**
   * `BottomSheetFooter`, not a flex child.
   *
   * The sheet's content container is as tall as its LARGEST snap point and
   * the sheet translates down to show the current one, so a footer at the
   * bottom of a `flex: 1` child sits 30% of a screen below the fold at the
   * first stop. This component is positioned against the visible top edge and
   * animates with the sheet, which is the whole reason it exists.
   */
  const footer = useCallback((props: BottomSheetFooterProps) => (
    <BottomSheetFooter {...props}>
      <View style={[s.foot, { paddingBottom: insets.bottom + space[4] }]}>
        <DishChoiceFooter choice={choice} />
      </View>
    </BottomSheetFooter>
  ), [choice, insets.bottom]);

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={SNAP}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClosed}
      backdropComponent={backdrop}
      footerComponent={footer}
      backgroundStyle={s.sheet}
      handleIndicatorStyle={s.grip}
      // The notes field is the only input in here and it is the last thing in
      // the scroll: without this the keyboard covers the field that raised it.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel="Dish options"
    >
      {choice.detail ? (
        <BottomSheetScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingBottom: FOOT_CLEARANCE + insets.bottom + space[4] },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <DishChoiceBody choice={choice} Input={BottomSheetTextInput} />
        </BottomSheetScrollView>
      ) : (
        <DishSkeleton />
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // `paper`, not `card`: the sheet is a surface the app stands on for a
  // moment, not an object floating on it. The backdrop is what separates it
  // from the menu underneath.
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  grip: { backgroundColor: colors.lineFaint, width: 44 },

  scroll: { paddingHorizontal: space[5], paddingTop: space[2], gap: space[4] },

  foot: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
});
