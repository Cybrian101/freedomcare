# FreedomCare design

White canvas, soft teal primary, sage/sky supporting, Freedom Trust red (`accent-*`) only for sign-out, danger and the odd CTA. Font: Plus Jakarta Sans. Tokens are in `src/app/globals.css` (`@theme`).

Tokens: `teal-50..900`, `sage-*`, `sky-*`, `accent-*`, `ink / ink-soft / ink-muted`, `line`, status pairs `ok|warn|bad|info-{bg,fg}`, `rounded-card`, `shadow-card`, `shadow-pop`, animations `animate-fade-up|sheet-up|shimmer`.

Components (`@/components/ui`): Button (primary/secondary/ghost/danger/accent, md/lg, full, loading, href), Card, SectionTitle, PageHeader, Input (label/hint/error), Badge, StatusPill (pending/attended/distributed/not_attended), Stat, ProgressRing, Skeleton, EmptyState, Sheet, ToastProvider/useToast, Stepper, SegmentedControl, cn.

Shell: `AppShell` (client; `syncSlot`, `userEmail`, `signOutAction`), `AppFrame` (server wrapper). Nav: /, /scan, /desk, /queue. Touch targets are 44px minimum (buttons 48/56px).
