import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered right-aligned on the same row as the title. */
  actions?: React.ReactNode;
}

/**
 * The single title treatment for every page and section. Replaces the four
 * different heading styles that had grown across Home, Settings, Onboarding,
 * and Setup.
 */
function PageHeader({ title, description, actions, className, children, ...props }: PageHeaderProps) {
  return (
    <header
      className={cn("shrink-0 border-b border-border bg-background px-6 py-5", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export { PageHeader };
