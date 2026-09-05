import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  SERVICE_CATALOG,
} from "@keypage/shared";
import { type KeyboardEvent, useCallback, useId, useRef } from "react";

import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/cn";

type ServicePickerProps = {
  value: string;
  onChange(serviceId: string): void;
  customName: string;
  onCustomNameChange(next: string): void;
  error?: string;
  disabled?: boolean;
};

export function ServicePicker({
  value,
  onChange,
  customName,
  onCustomNameChange,
  error,
  disabled = false,
}: ServicePickerProps) {
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const errorId = error ? `${groupId}-error` : undefined;
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectIndex = useCallback(
    (index: number) => {
      const entry = SERVICE_CATALOG[index];
      if (!entry || disabled) return;
      onChange(entry.id);
      tileRefs.current[index]?.focus();
    },
    [disabled, onChange],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    const currentIndex = SERVICE_CATALOG.findIndex((entry) => entry.id === value);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        selectIndex((safeIndex + 1) % SERVICE_CATALOG.length);
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        selectIndex(
          (safeIndex - 1 + SERVICE_CATALOG.length) % SERVICE_CATALOG.length,
        );
        break;
      }
      case "Home": {
        event.preventDefault();
        selectIndex(0);
        break;
      }
      case "End": {
        event.preventDefault();
        selectIndex(SERVICE_CATALOG.length - 1);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm text-text">
        Service
      </span>
      <div
        role="radiogroup"
        tabIndex={-1}
        aria-labelledby={labelId}
        aria-describedby={errorId}
        aria-invalid={error ? true : undefined}
        className="grid grid-cols-2 gap-2 outline-none sm:grid-cols-3"
        onKeyDown={handleKeyDown}
      >
        {SERVICE_CATALOG.map((entry, index) => {
          const selected = value === entry.id;
          return (
            <button
              key={entry.id}
              ref={(element) => {
                tileRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(entry.id)}
              className={cn(
                "pressable flex items-center gap-2 rounded-sm border bg-obsidian/55 px-3 py-2.5 text-left",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-brass/80 bg-brass/10 shadow-[inset_0_1px_0_rgba(200,162,74,0.18)] ring-1 ring-brass/50"
                  : "border-hairline hover:border-brass/35 hover:bg-surface/45",
              )}
            >
              <ServiceIcon serviceId={entry.id} size="sm" />
              <span className="text-sm text-text">{entry.displayName}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {value === "custom" ? (
        <div className="field-reveal">
          <TextField
          label="Custom service name"
          value={customName}
          onChange={(event) => onCustomNameChange(event.target.value)}
          disabled={disabled}
          maxLength={KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX}
          required
          />
        </div>
      ) : null}
    </div>
  );
}
