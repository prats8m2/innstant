import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '@/lib/theme';

/**
 * A dish photograph. One implementation, because there is one right answer
 * to every question it raises and four screens that would otherwise each
 * answer them differently.
 *
 * ─── Why `expo-image` and not React Native's `Image` ──────────────────────
 *
 * Three things the built-in one does not do, all of which show up on exactly
 * the connection this app runs on — hotel wifi, or a phone on the street
 * outside a restaurant:
 *
 *   · a memory AND disk cache, so the second look at a menu costs nothing
 *   · a blurhash placeholder, which is what `menu_items.blurhash` has been
 *     waiting for since the schema was written ("Rendered while the image
 *     loads, so a slow hotel wifi connection does not show a grey box")
 *   · a cross-fade on decode, instead of a photograph snapping into place
 *
 * ─── The placeholder is the point ─────────────────────────────────────────
 *
 * A grey rectangle that becomes a photograph reads as a page still loading.
 * A blurred impression of the right colours that sharpens reads as a
 * photograph arriving. It is the same wait.
 *
 * Nothing generates blurhashes yet — the column is null everywhere, and the
 * upload pipeline is what will fill it. Until then this falls back to the
 * card colour, which is at least the right darkness and does not flash white
 * on a dark screen.
 */
export function DishPhoto({
  uri,
  blurhash,
  name,
  size = 112,
}: {
  uri: string;
  blurhash?: string | null;
  name: string;
  size?: number;
}) {
  return (
    <View style={[s.frame, { width: size, height: size }]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        /* The blurhash when there is one. When there is not, the frame's own
           background shows through — which is the card colour, not white.
           `placeholder` takes an image, not a colour, so the fallback has to
           live on the View: a pale rectangle on a dark ground is the most
           visible thing on screen for as long as it is there. */
        placeholder={blurhash ? { blurhash } : undefined}
        placeholderContentFit="cover"
        /* 180ms, the bottom of the motion band. Long enough to read as a
           fade, short enough that a list of ten does not shimmer. */
        transition={180}
        cachePolicy="memory-disk"
        /* The name, not "image of the dish" — a screen reader already says
           it is an image, and the dish name is beside it in the row, so this
           is marked decorative rather than read twice. */
        accessibilityLabel={name}
        accessible={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    /* The app's sharp radius, not the rounded corners every delivery app
       uses. The photography is borrowed; the shape is not (D-050). */
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
