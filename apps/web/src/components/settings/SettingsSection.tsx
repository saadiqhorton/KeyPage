import { type ReactNode } from "react";

type SettingsSectionProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-medium tracking-[-0.02em] text-text">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
