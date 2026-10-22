export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6 animate-fade-up">
      <div className="size-16 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center mb-4">
        {icon ?? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        )}
      </div>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {body && <p className="text-ink-muted mt-1 max-w-xs">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
