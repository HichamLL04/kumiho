import { KeyRound, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Fragment, useEffect, useId, useRef } from "react";
import type { PluginAuthAction, PluginConfigSchemaField, PluginConfigStatus, PluginLocalizedString, PluginManifest } from "../../types/plugin";
import styles from "./PluginConfigModal.module.css";

interface PluginConfigModalProps {
  plugin: PluginManifest;
  configStatus?: PluginConfigStatus;
  busy: boolean;
  configDrafts: Record<string, string>;
  authDrafts: Record<string, string>;
  onClose: () => void;
  onConfigDraftChange: (fieldKey: string, value: string) => void;
  onConfigSave: (fieldKey: string) => void;
  onConfigDelete: (fieldKey: string) => void;
  onAuthDraftChange: (fieldKey: string, value: string) => void;
  onAuthAction: (actionId: string) => void;
  onDeleteAuthAction: (actionId: string) => void;
}

function humanizeConfigField(key: string) {
  switch (key) {
    case "api_key":
      return "API Key";
    case "access_token":
      return "Access Token";
    case "refresh_token":
      return "Refresh Token";
    default:
      return key
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function localizedText(
  locale: string,
  bundle?: PluginLocalizedString,
  fallback?: string,
) {
  if (!bundle) return fallback || "";
  const normalized = locale.toLowerCase();
  const short = normalized.split("-")[0];
  return bundle[normalized] || bundle[short] || bundle.en || fallback || "";
}

function configuredForAction(action: PluginAuthAction | undefined, configStatus?: PluginConfigStatus) {
  if (!action || !configStatus) return false;
  const mappedKeys = Object.keys(action.store_mappings || {});
  if (mappedKeys.length === 0) return false;
  return mappedKeys.some((key) => configStatus.fields.some((field) => field.key === key && field.configured));
}

function shouldRenderSecretField(fieldKey: string, action?: PluginAuthAction) {
  if (!action?.store_mappings) return true;
  return !(fieldKey in action.store_mappings);
}

function renderLinkedText(text: string) {
  const lines = text.split("\n");
  const splitPattern = /(https?:\/\/[^\s]+)/g;
  const linkPattern = /^https?:\/\/[^\s]+$/;

  return lines.map((line, lineIndex) => (
    <Fragment key={`line-${lineIndex}`}>
      {line.split(splitPattern).map((part, partIndex) => {
        if (linkPattern.test(part)) {
          return (
            <a
              key={`part-${lineIndex}-${partIndex}`}
              className={styles.inlineLink}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part}
            </a>
          );
        }
        return <Fragment key={`part-${lineIndex}-${partIndex}`}>{part}</Fragment>;
      })}
      {lineIndex < lines.length - 1 && <br />}
    </Fragment>
  ));
}

export function PluginConfigModal({
  plugin,
  configStatus,
  busy,
  configDrafts,
  authDrafts,
  onClose,
  onConfigDraftChange,
  onConfigSave,
  onConfigDelete,
  onAuthDraftChange,
  onAuthAction,
  onDeleteAuthAction,
}: PluginConfigModalProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const locale = i18n.language || "ko";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const secretFields = configStatus?.fields.filter((field) => field.type === "secret") || [];
  const authAction = plugin.auth?.actions?.[0];
  const actionConfigured = configuredForAction(authAction, configStatus);
  const visibleSecretFields = secretFields.filter((field) => shouldRenderSecretField(field.key, authAction));
  const actionTitle = localizedText(locale, authAction?.title_i18n, authAction?.title);
  const modalDescription = actionTitle
    ? t("settings.plugins.secret.auth_modal_desc", { title: actionTitle })
    : t("settings.plugins.secret.desc");
  const allConfigured = secretFields.length > 0 && secretFields.every((field) => field.configured);
  const fieldLabel = (field: PluginConfigSchemaField) => localizedText(locale, field.label_i18n, field.label || humanizeConfigField(field.key));
  const fieldPlaceholder = (field: PluginConfigSchemaField) => localizedText(locale, field.placeholder_i18n, field.placeholder || localizedText(locale, field.description_i18n, field.description));

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const root = modalRef.current;
      if (!root) {
        return;
      }

      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h5 id={titleId}>{plugin.name} {t("settings.plugins.secret.title")}</h5>
            <p>{modalDescription}</p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.stateBadge} ${allConfigured ? styles.stateBadgeActive : styles.stateBadgeInactive}`}>
              {allConfigured ? t("settings.plugins.secret.configured") : t("settings.plugins.secret.not_configured")}
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={t("common.close")}
              ref={closeButtonRef}
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          {authAction && (
            <div className={styles.notes}>
              {localizedText(locale, authAction.description_i18n, authAction.description) && (
                <p>{renderLinkedText(localizedText(locale, authAction.description_i18n, authAction.description))}</p>
              )}
              {authAction.fields.map((field) => (
                <label key={field.key} className={styles.field}>
                  <span>{fieldLabel(field)}</span>
                  <input
                    type={field.type === "secret" ? "password" : "text"}
                    autoComplete={field.auto_complete || (field.type === "secret" ? "off" : "on")}
                    value={authDrafts[field.key] || ""}
                    onChange={(event) => onAuthDraftChange(field.key, event.target.value)}
                    placeholder={fieldPlaceholder(field)}
                  />
                </label>
              ))}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionPrimary}
                  onClick={() => onAuthAction(authAction.id)}
                  disabled={busy}
                >
                  <KeyRound size={14} />
                  <span>{actionConfigured
                    ? (localizedText(locale, authAction.repeat_label_i18n, authAction.repeat_label) || localizedText(locale, authAction.button_label_i18n, authAction.button_label) || t("settings.plugins.secret.save"))
                    : (localizedText(locale, authAction.button_label_i18n, authAction.button_label) || t("settings.plugins.secret.save"))}
                  </span>
                </button>
                {actionConfigured && (
                  <button
                    type="button"
                    className={styles.actionDanger}
                    onClick={() => onDeleteAuthAction(authAction.id)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                    <span>{localizedText(locale, authAction.delete_label_i18n, authAction.delete_label) || t("settings.plugins.secret.delete")}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {visibleSecretFields.map((field) => (
            <div key={field.key}>
              {field.configured && (
                <div className={styles.notes}>
                  <p>{t("settings.plugins.secret.configured_hint", { field: humanizeConfigField(field.key), masked: field.masked_hint || "••••" })}</p>
                  <p>{t("settings.plugins.secret.source_hint", { source: field.source || "-" })}</p>
                </div>
              )}

              <label className={styles.field}>
                <span>{humanizeConfigField(field.key)}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={configDrafts[field.key] || ""}
                  onChange={(event) => onConfigDraftChange(field.key, event.target.value)}
                  placeholder={t("settings.plugins.secret.placeholder")}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionPrimary}
                  onClick={() => onConfigSave(field.key)}
                  disabled={busy}
                >
                  <KeyRound size={14} />
                  <span>{t("settings.plugins.secret.save")}</span>
                </button>
                {field.configured && field.source === "secret" && (
                  <button
                    type="button"
                    className={styles.actionDanger}
                    onClick={() => onConfigDelete(field.key)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                    <span>{t("settings.plugins.secret.delete")}</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className={styles.notes}>
            <p>{t("settings.plugins.secret.apply_hint")}</p>
            <p>{t("settings.plugins.secret.flow_hint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
