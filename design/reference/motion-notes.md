# Motion notes

Static exports can't carry these. Fill this in from what Claude Design produced,
then treat it as the spec.

## Page load — room home
Sequence, timings, what staggers and in what order.

## Dish card → dish detail
Shared element transition. Which element is shared, how the image behaves,
what happens to surrounding content.

## Cart pill
How it morphs when an item is added. Scale, count tick, spring parameters.
Explicitly: it never slides in from off-screen.

## Category rail
Active pill translation on scroll. Scroll-into-view behaviour on tap.

## Sheets
Spring parameters, drag-to-dismiss threshold, backdrop behaviour.

## Skeletons
Which screens have them, and the shape they take.

## Reduced motion
What each of the above degrades to. Not "nothing" — a crossfade is usually right.
