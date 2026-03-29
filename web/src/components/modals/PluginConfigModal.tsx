import { KeyRound, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PluginConfigStatus, PluginManifest } from "../../types/plugin";
import styles from "./PluginConfigModal.module.css";

interface PluginConfigModalProps {
  plugin: PluginManifest;
  configStatus?: PluginConfigStatus;
  busy: boolean;
  configDrafts: Record<string, string>;
  kitsuLoginDraft?: { username: string; password: string };
  onClose: () => void;
  onConfigDraftChange: (fieldKey: string, value: string) => void;
  onConfigSave: (fieldKey: string) => void;
  onConfigDelete: (fieldKey: string) => void;
  onKitsuDraftChange: (draft: { username: string; password: string }) => void;
  onKitsuLogin: () => void;
  onKitsuLogout: () => void;
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

export function PluginConfigModal({
  plugin,
  configStatus,
  busy,
  configDrafts,
  kitsuLoginDraft,
  onClose,
  onConfigDraftChange,
  onConfigSave,
  onConfigDelete,
  onKitsuDraftChange,
  onKitsuLogin,
  onKitsuLogout,
}: PluginConfigModalProps) {
  const { t } = useTranslation();
  const secretFields = configStatus?.fields.filter((field) => field.type === "secret") || [];
  const isKitsuPlugin = plugin.id === "kumiho-plugin-metadata-kitsu";
  const kitsuTokensConfigured = isKitsuPlugin && secretFields.some((field) => field.configured);
  const modalDescription = isKitsuPlugin
    ? t("settings.plugins.kitsu_login.modal_desc")
    : t("settings.plugins.secret.desc");
  const allConfigured = secretFields.length > 0 && secretFields.every((field) => field.configured);

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-config-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h5 id="plugin-config-title">{plugin.name} {t("settings.plugins.secret.title")}</h5>
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
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.panel}>
          {isKitsuPlugin && (
            <div className={styles.notes}>
              <p>{t("settings.plugins.kitsu_login.desc")}</p>
              <label className={styles.field}>
                <span>{t("settings.plugins.kitsu_login.username")}</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={kitsuLoginDraft?.username || ""}
                  onChange={(event) => onKitsuDraftChange({
                    username: event.target.value,
                    password: kitsuLoginDraft?.password || "",
                  })}
                  placeholder={t("settings.plugins.kitsu_login.username_placeholder")}
                />
              </label>
              <label className={styles.field}>
                <span>{t("settings.plugins.kitsu_login.password")}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={kitsuLoginDraft?.password || ""}
                  onChange={(event) => onKitsuDraftChange({
                    username: kitsuLoginDraft?.username || "",
                    password: event.target.value,
                  })}
                  placeholder={t("settings.plugins.kitsu_login.password_placeholder")}
                />
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionPrimary}
                  onClick={onKitsuLogin}
                  disabled={busy}
                >
                  <KeyRound size={14} />
                  <span>{kitsuTokensConfigured ? t("settings.plugins.kitsu_login.relogin") : t("settings.plugins.kitsu_login.login")}</span>
                </button>
                {kitsuTokensConfigured && (
                  <button
                    type="button"
                    className={styles.actionDanger}
                    onClick={onKitsuLogout}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                    <span>{t("settings.plugins.kitsu_login.delete")}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {!isKitsuPlugin && secretFields.map((field) => (
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
            <p>{t(isKitsuPlugin ? "settings.plugins.kitsu_login.apply_hint" : "settings.plugins.secret.apply_hint")}</p>
            <p>{t(isKitsuPlugin ? "settings.plugins.kitsu_login.flow_hint" : "settings.plugins.secret.flow_hint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
