import { ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DishChoiceBody, DishChoiceFooter, useDishChoice } from '@/components/dish-choice';
import { DishSkeleton } from '@/components/skeleton';
import { Notice, Screen } from '@/components/ui';
import { colors, space } from '@/lib/theme';

/**
 * One dish, and the choices it carries, as a whole screen. D-080.
 *
 * ─── Why this still exists now that there is a sheet ───────────────────────
 *
 * Phase 1 moved modifier selection into a bottom sheet over the menu, which
 * is how somebody choosing a dish gets there from inside the app. A sheet
 * cannot be deep-linked to: there is no menu behind a cold launch on
 * `/dish/:id`, and a sheet floating over an empty ground is a bug that looks
 * like a design. So the route stays, and a link into it renders a page.
 *
 * Everything that decides anything — the preselected defaults, what a
 * single-choice group does to its siblings, which required group is still
 * unanswered, the running total, and the add itself — is in
 * `useDishChoice()`. This file is a ScrollView, a footer and the insets.
 */
export default function Dish() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const insets = useSafeAreaInsets();
  const choice = useDishChoice(itemId, () => router.back());

  if (choice.error && !choice.detail) {
    return <Screen style={s.center}><Notice>{choice.error}</Notice></Screen>;
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />

      {choice.detail ? (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <DishChoiceBody choice={choice} />
        </ScrollView>
      ) : (
        <DishSkeleton />
      )}

      <View style={[s.foot, { paddingBottom: insets.bottom + space[4] }]}>
        <DishChoiceFooter choice={choice} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5] },
  body: { paddingHorizontal: space[5], paddingBottom: space[6], gap: space[4] },

  foot: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
});
