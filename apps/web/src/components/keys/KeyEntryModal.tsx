import type { KeyEntry } from "@keypage/shared";
import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "@keypage/shared";
import { type FormEvent, useEffect, useId, useState } from "react";

import { ServicePicker } from "@/components/keys/ServicePicker";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Modal } from "@/components/ui/Modal";
import { PasswordField } from "@/components/ui/PasswordField";
import { TagInput } from "@/components/ui/TagInput";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { ApiError } from "@/lib/api";
import type { EditKeyEntryInput, NewKeyEntryInput } from "@/vault/useKeyEntries";

type KeyEntryModalProps =
  | {
      open: boolean;
      mode: "create";
      onClose(): void;
      onSubmit(values: NewKeyEntryInput): Promise<unknown>;
    }
  | {
      open: boolean;
      mode: "edit";
      entry: KeyEntry | null;
      onClose(): void;
      onSubmit(values: EditKeyEntryInput): Promise<unknown>;
    };

type FieldErrors = {
  label?: string;
  service?: string;
  customServiceName?: string;
  description?: string;
  tags?: string;
  keyValue?: string;
};

const INITIAL_FORM = {
  label: "",
  serviceId: "openai",
  customServiceName: "",
  description: "",
  tags: [] as string[],
  keyValue: "",
};

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    next.push(trimmed);
    if (next.length >= KEY_ENTRY_TAGS_MAX) break;
  }

  return next;
}

function validateForm(
  mode: "create" | "edit",
  label: string,
  serviceId: string,
  customServiceName: string,
  description: string,
  tags: string[],
  keyValue: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedLabel = label.trim();

  if (trimmedLabel.length === 0) {
    errors.label = "Label is required.";
  } else if (trimmedLabel.length > KEY_ENTRY_LABEL_MAX) {
    errors.label = `Label must be at most ${KEY_ENTRY_LABEL_MAX} characters.`;
  }

  if (serviceId === "custom") {
    const trimmedCustom = customServiceName.trim();
    if (trimmedCustom.length === 0) {
      errors.customServiceName = "Custom service name is required.";
    } else if (trimmedCustom.length > KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX) {
      errors.customServiceName = `Custom service name must be at most ${KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX} characters.`;
    }
  }

  const trimmedDescription = description.trim();
  if (trimmedDescription.length > KEY_ENTRY_DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${KEY_ENTRY_DESCRIPTION_MAX} characters.`;
  }

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0 || trimmed.length > KEY_ENTRY_TAG_MAX) {
      errors.tags = `Each tag must be 1..${KEY_ENTRY_TAG_MAX} characters.`;
      break;
    }
  }

  if (tags.length > KEY_ENTRY_TAGS_MAX) {
    errors.tags = `At most ${KEY_ENTRY_TAGS_MAX} tags allowed.`;
  }

  if (mode === "create" && keyValue.trim().length === 0) {
    errors.keyValue = "API Key value is required.";
  }

  return errors;
}

function seedFromEntry(entry: KeyEntry) {
  return {
    label: entry.label,
    serviceId: entry.serviceId,
    customServiceName: entry.customServiceName ?? "",
    description: entry.description ?? "",
    tags: [...entry.tags],
    keyValue: "",
  };
}

export function KeyEntryModal(props: KeyEntryModalProps) {
  const { open, mode, onClose } = props;
  const entry = mode === "edit" ? props.entry : null;
  const formId = useId();
  const [label, setLabel] = useState(INITIAL_FORM.label);
  const [serviceId, setServiceId] = useState(INITIAL_FORM.serviceId);
  const [customServiceName, setCustomServiceName] = useState(
    INITIAL_FORM.customServiceName,
  );
  const [description, setDescription] = useState(INITIAL_FORM.description);
  const [tags, setTags] = useState<string[]>(INITIAL_FORM.tags);
  const [keyValue, setKeyValue] = useState(INITIAL_FORM.keyValue);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (mode === "create") {
      setLabel(INITIAL_FORM.label);
      setServiceId(INITIAL_FORM.serviceId);
      setCustomServiceName(INITIAL_FORM.customServiceName);
      setDescription(INITIAL_FORM.description);
      setTags(INITIAL_FORM.tags);
      setKeyValue(INITIAL_FORM.keyValue);
    } else if (entry) {
      const seeded = seedFromEntry(entry);
      setLabel(seeded.label);
      setServiceId(seeded.serviceId);
      setCustomServiceName(seeded.customServiceName);
      setDescription(seeded.description);
      setTags(seeded.tags);
      setKeyValue(seeded.keyValue);
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(false);
  }, [open, mode, entry]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const normalizedTags = normalizeTags(tags);
    const errors = validateForm(
      mode,
      label,
      serviceId,
      customServiceName,
      description,
      normalizedTags,
      keyValue,
    );

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      if (mode === "create") {
        const values: NewKeyEntryInput = {
          label: label.trim(),
          serviceId,
          tags: normalizedTags,
          keyValue: keyValue.trim(),
        };

        if (serviceId === "custom") {
          values.customServiceName = customServiceName.trim();
        }

        const trimmedDescription = description.trim();
        if (trimmedDescription.length > 0) {
          values.description = trimmedDescription;
        }

        await props.onSubmit(values);
      } else {
        const values: EditKeyEntryInput = {
          label: label.trim(),
          serviceId,
          tags: normalizedTags,
        };

        if (serviceId === "custom") {
          values.customServiceName = customServiceName.trim();
        }

        const trimmedDescription = description.trim();
        if (trimmedDescription.length > 0) {
          values.description = trimmedDescription;
        }

        const trimmedKeyValue = keyValue.trim();
        if (trimmedKeyValue.length > 0) {
          values.keyValue = trimmedKeyValue;
        }

        await props.onSubmit(values);
      }
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : mode === "create"
            ? "Failed to create key entry."
            : "Failed to update key entry.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const isCreate = mode === "create";
  const title = isCreate ? "Add Key Entry" : "Edit Key Entry";
  const submitLabel = isCreate ? "Add Key Entry" : "Save Changes";
  const descriptionText = isCreate
    ? "Your API key is encrypted in the browser before it leaves this device."
    : "Update the details below. Enter a new API Key value only if you want to replace it — it is encrypted in the browser before it leaves this device.";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      eyebrow="Vault"
      title={title}
      description={descriptionText}
      busy={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-5"
        onSubmit={handleSubmit}
      >
        {submitError ? (
          <Callout tone="danger">{submitError}</Callout>
        ) : null}

        <TextField
          label="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          disabled={submitting}
          error={fieldErrors.label}
          maxLength={KEY_ENTRY_LABEL_MAX}
          required
          autoFocus
        />

        <ServicePicker
          value={serviceId}
          onChange={setServiceId}
          customName={customServiceName}
          onCustomNameChange={setCustomServiceName}
          error={fieldErrors.service ?? fieldErrors.customServiceName}
          disabled={submitting}
        />

        <div className="grid gap-5 border-t border-hairline pt-5">
          <TextArea
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            error={fieldErrors.description}
            maxLength={KEY_ENTRY_DESCRIPTION_MAX}
            rows={3}
          />

          <TagInput
            label="Tags"
            value={tags}
            onChange={setTags}
            max={KEY_ENTRY_TAGS_MAX}
            disabled={submitting}
            error={fieldErrors.tags}
            hint={`Up to ${KEY_ENTRY_TAGS_MAX} tags.`}
          />
        </div>

        <div className="border-t border-hairline pt-5">
          <PasswordField
            label={isCreate ? "API Key value" : "New API Key value"}
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            disabled={submitting}
            error={fieldErrors.keyValue}
            autoComplete="off"
            spellCheck={false}
            required={isCreate}
            hint={
              isCreate
                ? undefined
                : "Leave blank to keep the current API key."
            }
          />
        </div>
      </form>
    </Modal>
  );
}
