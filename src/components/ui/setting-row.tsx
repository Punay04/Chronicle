import * as React from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The control for this setting — switch, select, button, badge. */
  children?: React.ReactNode;
}

/**
 * A labelled row inside a settings Card. Rows divide themselves, so a Card
 * holding them should use `padding="none"` with `px-4` on this row's parent.
 */
function SettingRow({ label, description, children, className, ...props }: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border py-4 last:border-b-0",
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export { SettingRow };
