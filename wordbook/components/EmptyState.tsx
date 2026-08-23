/**
 * 统一的空态。
 *
 * 每个空态都必须给出下一步——只写「没有数据」的空态是死路：
 * 用户看到它只能自己猜该去哪儿。
 */
import type { LucideIcon } from 'lucide-react';

export function EmptyState({ Icon, title, hint, actionLabel, onAction }: {
  Icon: LucideIcon;
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Icon className="w-10 h-10 text-base-content/25" />
      <h3 className="text-lg font-semibold text-base-content/70">{title}</h3>
      <p className="text-sm text-base-content/50 max-w-sm">{hint}</p>
      {actionLabel && onAction && (
        <button className="btn btn-primary btn-sm mt-1" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
