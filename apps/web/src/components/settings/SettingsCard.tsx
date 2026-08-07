import { type ReactNode } from "react";

type SettingsCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function SettingsCard({ title, description, children }: SettingsCardProps) {
  return (
    <div className="bezel-shell">
      <div className="bezel-core flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-text">{title}</h3>
          {description ? <p className="text-xs text-muted">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
