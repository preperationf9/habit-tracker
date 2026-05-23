# TODO - HabitTracker UI/UX Premium + Mobile Fixes

## Plan (approved)
- [ ] Update mobile UI: mobile-first spacing, typography (16px+), bigger touch targets.
- [ ] Replace current mobile nav with fixed **bottom navigation** (Home / Habits / Stats / Profile) using one-hand layout.
- [ ] Add Landing/WOW hero section (gradient heading, animated glow button, smooth scroll) + mobile-first layout.
- [ ] Upgrade habit dashboard “addictive” feel: streak visuals/glow, achievements badges placeholders, XP dopamine pop (existing + extend).
- [ ] Improve analytics: populate weekly & monthly progress + best habit + missed habits + completion%.
- [ ] Premium dark styling: glassmorphism blur cards, neon glow borders, soft shadows, smooth transitions.
- [ ] Empty state: illustration-like icon, motivational text, animated CTA.
- [ ] Loading: skeleton loading + fade transitions.

## Implementation phases
- [ ] Phase 1: Layout/CSS responsiveness + bottom nav + hide sidebar on mobile.
- [ ] Phase 2: Hero/landing section + smooth entry.
- [ ] Phase 3: JS logic: analytics computation + animations + (streak/badges if UI added).
- [ ] Phase 4: Skeleton/empty/loading states.

## Validation checklist
- [ ] On mobile width (~<=768px), bottom nav is fixed and thumb-friendly.
- [ ] Tap targets meet minimum size (>=44px where applicable).
- [ ] Empty state looks premium and not boring.
- [ ] Weekly/monthly analytics render without console errors.
- [ ] Loading/skeleton appears on initial render.


