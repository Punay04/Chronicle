import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A primary action button, or a short row of them. */
  action?: React.ReactNode;
}

/**
 * One treatment for every "nothing here yet" surface. Centers in whatever
 * space it is given, so drop it directly inside a flex-1 content pane.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-6 w-6 text-muted-foreground/60" aria-hidden />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
