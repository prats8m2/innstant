/**
 * Babel, which exists only because Reanimated cannot work without it.
 *
 * `expo start` needs no babel config of its own — `babel-preset-expo` is the
 * default. This file exists for the plugin below, and for the note attached
 * to it, which is the kind of thing that costs an afternoon when it is
 * missing.
 *
 * ─── The plugin, and why it is not `react-native-reanimated/plugin` ────────
 *
 * Reanimated 3 shipped its own Babel plugin at that path, and almost every
 * tutorial still says to use it. Reanimated 4 moved the worklet transform out
 * into `react-native-worklets`, so the old path no longer exists and naming
 * it fails the bundle with a resolution error.
 *
 * The transform is what turns a function marked `'worklet'` into something
 * that can run on the UI thread. Without it, every animation silently falls
 * back to the JS thread, or throws at the first `useAnimatedStyle` — which
 * presents as a blank screen in a release build, not as an error.
 *
 * ─── Version pairing ──────────────────────────────────────────────────────
 *
 * `react-native-reanimated@4.5.1` declares a peer of
 * `react-native-worklets@0.10.x`, and `expo install` resolved 0.13.0 — a
 * mismatch that typechecks, bundles, and breaks at runtime. Both are pinned
 * exactly, to the pair in `expo/bundledNativeModules.json`. Change one and
 * you change the other.
 *
 * It must be LAST in the plugin list. The transform rewrites function bodies,
 * so anything that runs after it sees code it does not expect.
 */
module.exports = function babel(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
