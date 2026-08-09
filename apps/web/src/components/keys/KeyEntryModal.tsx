import type { KeyEntry } from "@keypage/shared";
import {
  KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX,
  KEY_ENTRY_DESCRIPTION_MAX,
  KEY_ENTRY_LABEL_MAX,
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
  KeyEntryFieldError,
  normalizeKeyEntryWriteFields,
  normalizeTags,
  normalizeTagsCapped,
} from "@keypage/shared";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { ServicePicker } from "@/components/keys/ServicePicker";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Modal } from "@/components/ui/Modal";
import { PasswordField } from "@/components/ui/PasswordField";
import { TagInput } from "@/components/ui/TagInput";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { decryptKeyValue } from "@/crypto/key-entry.js";
import { ApiError } from "@/lib/api";
import { onKeyCleared } from "@/vault/session-keys.js";
import type {
  EditKeyEntryInput,
  NewKeyEntryInput,
} from "@/vault/keyEntryOperations";

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

type PrefillState = "idle" | "loading" | "ready" | "failed";

const INITIAL_FORM = {
  label: "",
  serviceId: "openai",
  customServiceName: "",
  description: "",
  tags: [] as string[],
  keyValue: "",
};

function mapSharedFieldErrors(error: KeyEntryFieldError): FieldErrors {
  const errors: FieldErrors = {};
  for (const detail of error.details) {
    switch (detail.field) {
      case "label":
        errors.label = "Label is required.";
        break;
      case "serviceId":
        errors.service = "Choose a service.";
        break;
      case "customServiceName":
        errors.customServiceName = detail.message.includes("at most")
          ? `Custom service name must be at most ${KEY_ENTRY_CUSTOM_SERVICE_NAME_MAX} characters.`
          : "Custom service name is required.";
        break;
      case "description":
        errors.description = `Description must be at most ${KEY_ENTRY_DESCRIPTION_MAX} characters.`;
        break;
      case "tags":
        errors.tags = detail.message.includes("at most")
          ? `At most ${KEY_ENTRY_TAGS_MAX} tags allowed.`
          : `Each tag must be 1..${KEY_ENTRY_TAG_MAX} characters.`;
        break;
      default:
        break;
    }
  }
  return errors;
}

function validateForm(
  mode: "create" | "edit",
  prefillState: PrefillState,
  label: string,
  serviceId: string,
  customServiceName: string,
  description: string,
  tags: string[],
  keyValue: string,
): FieldErrors {
  const errors: FieldErrors = {};

  try {
    normalizeKeyEntryWriteFields({
      label,
      serviceId,
      customServiceName: serviceId === "custom" ? customServiceName : undefined,
      description: description.trim().length > 0 ? description : undefined,
      tags,
    });
  } catch (error) {
    if (error instanceof KeyEntryFieldError) {
      Object.assign(errors, mapSharedFieldErrors(error));
      const trimmedLabel = label.trim();
      if (errors.label) {
        errors.label =
          trimmedLabel.length === 0
            ? "Label is required."
            : `Label must be at most ${KEY_ENTRY_LABEL_MAX} characters.`;
      }
    } else {
      throw error;
    }
  }

  if (mode === "create" && keyValue.trim().length === 0) {
    errors.keyValue = "API Key value is required.";
  }

  if (mode === "edit" && prefillState === "ready" && keyValue.trim().length === 0) {
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
  };
}

function resetKeyValueState(
  setKeyValue: (value: string) => void,
  setPrefillState: (state: PrefillState) => void,
  setDecryptWarning: (value: boolean) => void,
  originalKeyValueRef: { current: string },
) {
  setKeyValue("");
  originalKeyValueRef.current = "";
  setPrefillState("idle");
  setDecryptWarning(false);
}

export function KeyEntryModal(props: KeyEntryModalProps) {
  const { open, mode, onClose } = props;
  const entry = mode === "edit" ? props.entry : null;
  const formId = useId();
  const originalKeyValueRef = useRef("");
  const [label, setLabel] = useState(INITIAL_FORM.label);
  const [serviceId, setServiceId] = useState(INITIAL_FORM.serviceId);
  const [customServiceName, setCustomServiceName] = useState(
    INITIAL_FORM.customServiceName,
  );
  const [description, setDescription] = useState(INITIAL_FORM.description);
  const [tags, setTags] = useState<string[]>(INITIAL_FORM.tags);
  const [keyValue, setKeyValue] = useState(INITIAL_FORM.keyValue);
  const [prefillState, setPrefillState] = useState<PrefillState>("idle");
  const [decryptWarning, setDecryptWarning] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return onKeyCleared(() => {
      resetKeyValueState(
        setKeyValue,
        setPrefillState,
        setDecryptWarning,
        originalKeyValueRef,
      );
    });
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    resetKeyValueState(
      setKeyValue,
      setPrefillState,
      setDecryptWarning,
      originalKeyValueRef,
    );
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(false);

    if (mode === "create") {
      setLabel(INITIAL_FORM.label);
      setServiceId(INITIAL_FORM.serviceId);
      setCustomServiceName(INITIAL_FORM.customServiceName);
      setDescription(INITIAL_FORM.description);
      setTags(INITIAL_FORM.tags);
      resetKeyValueState(
        setKeyValue,
        setPrefillState,
        setDecryptWarning,
        originalKeyValueRef,
      );
      return;
    }

    if (!entry) {
      return;
    }

    const seeded = seedFromEntry(entry);
    setLabel(seeded.label);
    setServiceId(seeded.serviceId);
    setCustomServiceName(seeded.customServiceName);
    setDescription(seeded.description);
    setTags(seeded.tags);
    setKeyValue("");
    originalKeyValueRef.current = "";
    setPrefillState("loading");
    setDecryptWarning(false);

    let cancelled = false;

    void (async () => {
      try {
        const decrypted = await decryptKeyValue(entry);
        if (cancelled) {
          return;
        }
        originalKeyValueRef.current = decrypted;
        setKeyValue(decrypted);
        setPrefillState("ready");
      } catch {
        if (cancelled) {
          return;
        }
        originalKeyValueRef.current = "";
        setKeyValue("");
        setPrefillState("failed");
        setDecryptWarning(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, mode, entry]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const normalizedTags = normalizeTagsCapped(tags, KEY_ENTRY_TAGS_MAX);
    const errors = validateForm(
      mode,
      prefillState,
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

    const fields = normalizeKeyEntryWriteFields({
      label,
      serviceId,
      customServiceName: serviceId === "custom" ? customServiceName : undefined,
      description: description.trim().length > 0 ? description : undefined,
      tags: normalizeTags(normalizedTags),
    });

    setFieldErrors({});
    setSubmitting(true);

    try {
      if (mode === "create") {
        const values: NewKeyEntryInput = {
          label: fields.label,
          serviceId: fields.serviceId,
          tags: fields.tags,
          keyValue: keyValue.trim(),
          ...(fields.customServiceName !== null
            ? { customServiceName: fields.customServiceName }
            : {}),
          ...(fields.description !== null
            ? { description: fields.description }
            : {}),
        };

        await props.onSubmit(values);
      } else {
        const values: EditKeyEntryInput = {
          label: fields.label,
          serviceId: fields.serviceId,
          tags: fields.tags,
          ...(fields.customServiceName !== null
            ? { customServiceName: fields.customServiceName }
            : {}),
          ...(fields.description !== null
            ? { description: fields.description }
            : {}),
        };

        const trimmedKeyValue = keyValue.trim();
        if (prefillState === "ready") {
          if (trimmedKeyValue !== originalKeyValueRef.current) {
            values.keyValue = trimmedKeyValue;
          }
        } else if (trimmedKeyValue.length > 0) {
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
    : "Update the details below. The API key value is shown for editing and re-encrypted in the browser before it leaves this device.";
  const keyValueDisabled =
    submitting || (!isCreate && prefillState === "loading");
  const keyValueHint = isCreate
    ? undefined
    : prefillState === "failed"
      ? "Leave blank to keep the current API key."
      : prefillState === "loading"
        ? "Decrypting API key…"
        : undefined;

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

        {decryptWarning ? (
          <Callout tone="warning">
            Could not decrypt the current API key. Leave the field blank to keep
            the stored value, or enter a new key to replace it.
          </Callout>
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
            label="API Key value"
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            disabled={keyValueDisabled}
            error={fieldErrors.keyValue}
            autoComplete="off"
            spellCheck={false}
            required={isCreate || prefillState === "ready"}
            hint={keyValueHint}
          />
        </div>
      </form>
    </Modal>
  );
}
