```# Spatial Glass 3D — Cross-Device Consistency Upgrade

## Task
Make the Spatial Glass 3D UI visually IDENTICAL across desktop, laptop, tablet, Android, iPhone — while keeping ALL existing functionality (script.js untouched).

## Requirements (mandatory)
- SAME design system on all devices; only layout/spacing/sizing adapts.
- Keep all premium visuals: glass, blur, floating cards, depth, lighting, reflections, shadows, animations, glass buttons, glass progress, spatial modals.
- Reduce only the INTENSITY of expensive effects (blur/glow/shadow) on low-end mobile — never replace with flat UI.
- No hover-only interactions on touch; smooth touch micro-interactions.
- No notch overlap, no home-indicator overlap, no keyboard overlap, no clipped dialogs, no hidden buttons, no horizontal scroll.
- Preserve 100% of existing functionality (no script.js logic changes).

## Steps

- [x] 0. Analyze codebase + baseline QA (ID cross-check, assets, CSS braces, spatial-effects gating)
- [x] 1. index.html — add iOS/standalone PWA meta tags + color-scheme dark
- [x] 2. style.css — tall-modal fix (margin:auto centering) so no clipped dialogs on phones
- [x] 3. style.css — iOS safe-area insets (env(safe-area-inset-*)) for main/modal/footer/standalone
- [x] 4. style.css — prevent iOS input zoom (16px inputs/selects); keep premium glass styling
- [x] 5. style.css — touch polish (tap-highlight transparent, touch-action manipulation, text-size-adjust)
- [x] 6. style.css — .top-right wrap + auth-badge ellipsis (no 320px overflow / clipped text)
- [x] 7. style.css — add 360px and 412px breakpoint tuning (full width coverage)
- [x] 8. style.css — mobile performance guard (reduce blur/glow/shadow intensity ONLY, keep glass identity)
- [x] 9. style.css — touch card :active micro-interaction under @media(hover:none)
- [x] 10. style.css — 100dvh viewport-height fallbacks (accurate mobile height, keyboard/URL-bar)
- [x] 11. Verify spatial-effects.js — no change needed; confirm gating still correct
- [x] 12. Create _qa_responsive.cjs — automated cross-device QA (all widths, safe-area, inputs, touch, glass never removed, overflow, PWA meta, brace balance)
- [x] 13. Run full QA suite + fix any failures
- [x] 14. Final verification summary (320/360/390/412/768/1024/desktop + portrait/landscape + PWA)

## Result
Spatial Glass 3D premium UI consistent across ALL devices.

