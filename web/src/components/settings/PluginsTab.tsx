import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Blocks, Download, HeartPulse, KeyRound, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { pluginAPI } from "../../api/client";
import type { PluginAuthAction, PluginConfigStatus, PluginLocalizedString, PluginManifest, PluginRecord, PluginUpdateSummary } from "../../types/plugin";
import { PluginConfigModal } from "../modals/PluginConfigModal";
import { UpdateBadge } from "../common/UpdateBadge";
import { Toast } from "../common/Toast";
import styles from "./SettingsComponents.module.css";

type ToastState = { type: "success" | "error" | "info"; message: string } | null;

interface PluginsTabProps {
  onUpdateStateChange?: (hasUpdates: boolean) => void;
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

function stateTone(state: string) {
  switch (state) {
    case "active":
      return "active";
    case "error":
    case "unhealthy":
      return "error";
    case "disabled":
      return "disabled";
    case "registered":
    case "installed":
    case "activation_pending":
      return "installed";
    default:
      return "inactive";
  }
}

function iconURL(plugin: PluginManifest, record?: PluginRecord) {
  return record?.manifest.icons?.svg
    || record?.manifest.icons?.png
    || plugin.icons?.svg
    || plugin.icons?.png
    || null;
}

function supportsAPIKeyConfig(config?: PluginConfigStatus) {
  return Boolean(config?.fields?.some((field) => field.type === "secret"));
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

function localizedErrorMessage(
  locale: string,
  code: string | undefined,
  messages?: Record<string, string>,
  messagesI18n?: Record<string, PluginLocalizedString>,
) {
  if (!code) return "";
  return localizedText(locale, messagesI18n?.[code], messages?.[code]);
}

export function PluginsTab({ onUpdateStateChange }: PluginsTabProps) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [healthById, setHealthById] = useState<Record<string, string>>({});
  const [configById, setConfigById] = useState<Record<string, PluginConfigStatus>>({});
  const [status, setStatus] = useState<ToastState>(null);
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, string>>>({});
  const [authDrafts, setAuthDrafts] = useState<Record<string, Record<string, string>>>({});
  const [updateSummary, setUpdateSummary] = useState<PluginUpdateSummary | null>(null);

  const installedById = useMemo(() => new Map(installed.map((item) => [item.id, item])), [installed]);
  const updateById = useMemo(
    () => new Map((updateSummary?.plugins || []).map((item) => [item.plugin_id, item])),
    [updateSummary],
  );
  const selectedConfigPlugin = useMemo(
    () => catalog.find((plugin) => plugin.id === expandedConfigId) || null,
    [catalog, expandedConfigId],
  );
  const unmanagedInstalled = useMemo(
    () => installed.filter((item) => !catalog.some((plugin) => plugin.id === item.id)),
    [catalog, installed],
  );

  const loadUpdates = useCallback(async (force = false) => {
    const summary = await pluginAPI.getUpdates(force);
    setUpdateSummary(summary);
    onUpdateStateChange?.(summary.has_updates);
    return summary;
  }, [onUpdateStateChange]);

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const [catalogRes, installedRes] = await Promise.all([pluginAPI.catalog(), pluginAPI.list()]);
      const nextCatalog = catalogRes.plugins || [];
      const nextInstalled = installedRes.plugins || [];
      setCatalog(nextCatalog);
      setInstalled(nextInstalled);

      const pluginIDs = Array.from(new Set([
        ...nextCatalog.map((item) => item.id),
        ...nextInstalled.map((item) => item.id),
      ]));
      const configPairs = await Promise.all(pluginIDs.map(async (pluginId) => {
        try {
          const config = await pluginAPI.getConfig(pluginId);
          return [pluginId, config] as const;
        } catch {
          return [pluginId, { plugin_id: pluginId, fields: [] }] as const;
        }
      }));
      setConfigById(Object.fromEntries(configPairs));
      await loadUpdates(false);
    } catch (error) {
      console.error("Failed to load plugin data:", error);
      setStatus({ type: "error", message: t("settings.plugins.toast.load_failed") });
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [loadUpdates, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadUpdates();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadUpdates]);

  const handleCheckUpdates = async () => {
    setBusyId("__plugin_update_check__");
    try {
      const summary = await loadUpdates(true);
      setStatus({
        type: "success",
        message: summary.has_updates
          ? t("settings.plugins.toast.update_found", { count: summary.count })
          : t("settings.plugins.toast.update_checked"),
      });
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { error?: string } } };
      if (err.response?.status === 429) {
        setStatus({ type: "error", message: err.response.data?.error || t("settings.plugins.toast.update_rate_limited") });
      } else {
        setStatus({ type: "error", message: t("settings.plugins.toast.update_check_failed") });
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleInstall = async (pluginId: string) => {
    setBusyId(pluginId);
    try {
      await pluginAPI.install(pluginId);
      setStatus({ type: "success", message: t("settings.plugins.toast.install_success") });
      await load(true);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.plugins.toast.install_failed") });
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    setBusyId(pluginId);
    try {
      await pluginAPI.uninstall(pluginId);
      setStatus({ type: "success", message: t("settings.plugins.toast.uninstall_success") });
      await load(true);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.plugins.toast.uninstall_failed") });
    } finally {
      setBusyId(null);
    }
  };

  const handleActivate = async (pluginId: string, active: boolean) => {
    setBusyId(pluginId);
    try {
      const nextRecord = active
        ? await pluginAPI.deactivate(pluginId)
        : await pluginAPI.activate(pluginId);

      setInstalled((prev) => prev.map((item) => (item.id === pluginId ? nextRecord : item)));
      setStatus({ type: "success", message: active ? t("settings.plugins.toast.deactivated") : t("settings.plugins.toast.activated") });
      await load(true);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.plugins.toast.action_failed") });
    } finally {
      setBusyId(null);
    }
  };

  const handleHealth = async (pluginId: string) => {
    setBusyId(pluginId);
    try {
      const health = await pluginAPI.health(pluginId);
      setHealthById((prev) => ({ ...prev, [pluginId]: `${health.status}${health.message ? ` · ${health.message}` : ""}` }));
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setHealthById((prev) => ({ ...prev, [pluginId]: err.response?.data?.error || "healthcheck failed" }));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfigSave = async (pluginId: string, fieldKey: string) => {
    const draft = configDrafts[pluginId]?.[fieldKey]?.trim();
    if (!draft) {
      setStatus({ type: "info", message: t("settings.plugins.toast.secret_required", { field: humanizeConfigField(fieldKey) }) });
      return;
    }

    setBusyId(pluginId);
    try {
      const response = await pluginAPI.updateConfig(pluginId, fieldKey, draft);
      setConfigById((prev) => ({ ...prev, [pluginId]: response.config }));
      setConfigDrafts((prev) => ({
        ...prev,
        [pluginId]: {
          ...(prev[pluginId] || {}),
          [fieldKey]: "",
        },
      }));
      await load(true);
      setStatus({
        type: "success",
        message: response.reactivation_required
          ? t("settings.plugins.toast.secret_saved_reactivate", { field: humanizeConfigField(fieldKey) })
          : t("settings.plugins.toast.secret_saved", { field: humanizeConfigField(fieldKey) }),
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.plugins.toast.secret_save_failed", { field: humanizeConfigField(fieldKey) }) });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfigDelete = async (pluginId: string, fieldKey: string) => {
    setBusyId(pluginId);
    try {
      const response = await pluginAPI.deleteConfig(pluginId, fieldKey);
      setConfigById((prev) => ({ ...prev, [pluginId]: response.config }));
      await load(true);
      setStatus({ type: "success", message: t("settings.plugins.toast.secret_deleted", { field: humanizeConfigField(fieldKey) }) });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setStatus({ type: "error", message: err.response?.data?.error || t("settings.plugins.toast.secret_delete_failed", { field: humanizeConfigField(fieldKey) }) });
    } finally {
      setBusyId(null);
    }
  };

  const handleAuthAction = async (pluginId: string, action: PluginAuthAction) => {
    const locale = i18n.language || "ko";
    const values = Object.fromEntries(
      action.fields.map((field) => [field.key, (authDrafts[pluginId]?.[field.key] || "").trim()]),
    );
    const missingField = action.fields.find((field) => field.required && !values[field.key]);
    if (missingField) {
      setStatus({
        type: "info",
        message: localizedText(locale, action.required_message_i18n, action.required_message)
          || t("settings.plugins.toast.auth_required", { field: localizedText(locale, missingField.label_i18n, missingField.label) || humanizeConfigField(missingField.key) }),
      });
      return;
    }

    setBusyId(pluginId);
    try {
      const response = await pluginAPI.runAuthAction(pluginId, action.id, values);
      setConfigById((prev) => ({ ...prev, [pluginId]: response.config }));
      setAuthDrafts((prev) => ({
        ...prev,
        [pluginId]: Object.fromEntries(action.fields.map((field) => [field.key, ""])),
      }));
      await load(true);
      setStatus({
        type: "success",
        message: response.reactivation_required
          ? (localizedText(locale, action.success_reactivate_message_i18n, action.success_reactivate_message)
            || t("settings.plugins.toast.auth_saved_reactivate", { title: localizedText(locale, action.title_i18n, action.title) }))
          : (localizedText(locale, action.success_message_i18n, action.success_message)
            || t("settings.plugins.toast.auth_saved", { title: localizedText(locale, action.title_i18n, action.title) })),
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; code?: string } } };
      setStatus({
        type: "error",
        message: localizedErrorMessage(locale, err.response?.data?.code, action.error_messages, action.error_messages_i18n)
          || err.response?.data?.error
          || localizedText(locale, action.error_message_i18n, action.error_message)
          || t("settings.plugins.toast.auth_failed", { title: localizedText(locale, action.title_i18n, action.title) }),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAuthAction = async (pluginId: string, action: PluginAuthAction) => {
    const locale = i18n.language || "ko";
    setBusyId(pluginId);
    try {
      const response = await pluginAPI.deleteAuthAction(pluginId, action.id);
      setConfigById((prev) => ({ ...prev, [pluginId]: response.config }));
      await load(true);
      setStatus({
        type: "success",
        message: response.reactivation_required
          ? (localizedText(locale, action.delete_reactivate_message_i18n, action.delete_reactivate_message)
            || t("settings.plugins.toast.auth_deleted_reactivate", { title: localizedText(locale, action.title_i18n, action.title) }))
          : (localizedText(locale, action.delete_message_i18n, action.delete_message)
            || t("settings.plugins.toast.auth_deleted", { title: localizedText(locale, action.title_i18n, action.title) })),
      });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; code?: string } } };
      setStatus({
        type: "error",
        message: localizedErrorMessage(locale, err.response?.data?.code, action.delete_error_messages, action.delete_error_messages_i18n)
          || err.response?.data?.error
          || localizedText(locale, action.delete_error_message_i18n, action.delete_error_message)
          || t("settings.plugins.toast.auth_delete_failed", { title: localizedText(locale, action.title_i18n, action.title) }),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.placeholderContent}>
          <Loader2 className={styles.loadingSpinner} size={24} />
          <p>{t("settings.plugins.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabContent}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}

      <div className={styles.tabHeader}>
        <div className={styles.tabHeaderRow}>
          <div>
            <h2>{t("settings.plugins.title")}</h2>
            <p className={styles.tabDescription}>{t("settings.plugins.desc")}</p>
          </div>
          <button
            type="button"
            className={styles.tabHeaderAction}
            onClick={() => void handleCheckUpdates()}
            disabled={busyId === "__plugin_update_check__"}
          >
            <RefreshCw
              size={14}
              className={busyId === "__plugin_update_check__" ? styles.spin : ""}
            />
            <span>{t("settings.plugins.check_updates")}</span>
          </button>
        </div>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Blocks size={18} />
            <h3>{t("settings.plugins.catalog_title")}</h3>
          </div>
          <div className={styles.pluginGrid}>
            {catalog.map((plugin) => {
              const installedRecord = installedById.get(plugin.id);
              const isInstalled = Boolean(installedRecord);
              const isActive = installedRecord?.state === "active";
              const isBusy = busyId === plugin.id;
              const currentState = installedRecord?.state || "not_installed";
              const tone = stateTone(currentState);
              const updateInfo = updateById.get(plugin.id);
              const hasUpdate = Boolean(updateInfo?.update_available);
              const canInstall = !installedRecord || hasUpdate || installedRecord.state === "error";
              const installLabel = hasUpdate
                ? t("settings.plugins.update")
                : (!installedRecord || installedRecord.manifest.version !== plugin.version
                    ? t("settings.plugins.install")
                    : t("settings.plugins.reinstall"));
              const iconSrc = iconURL(plugin, installedRecord);
              const configStatus = configById[plugin.id];
              const showConfig = supportsAPIKeyConfig(configStatus) || Boolean(plugin.auth?.actions?.length);
              const secretFields = configStatus?.fields.filter((field) => field.type === "secret") || [];
              const requiredFields = secretFields.filter((field) => field.required);
              const configReady = !showConfig || requiredFields.every((field) => field.configured);

              return (
                <article
                  key={plugin.id}
                  className={[
                    styles.pluginCard,
                    isActive ? styles.pluginCardActive : "",
                    tone === "error" ? styles.pluginCardError : "",
                  ].filter(Boolean).join(" ")}
                >
                  <div className={styles.pluginCardTop}>
                    <div className={`${styles.pluginIdentity} ${!isInstalled ? styles.pluginContentDimmed : ""}`}>
                      <div className={`${styles.pluginIconShell} ${!isInstalled ? styles.pluginIconShellDimmed : ""}`}>
                        {iconSrc ? (
                          <img
                            src={iconSrc}
                            alt={plugin.name}
                            className={styles.pluginIconImage}
                          />
                        ) : (
                          <Blocks size={28} className={styles.pluginIconFallback} />
                        )}
                        {hasUpdate && <UpdateBadge className={styles.pluginIconUpdateBadge} />}
                      </div>
                      <div className={styles.pluginHeading}>
                        <div className={styles.pluginTitleRow}>
                          <h4>{plugin.name}</h4>
                        </div>
                        <p className={styles.pluginAuthor}>
                          {t("settings.plugins.author")}: {plugin.author || "-"}
                        </p>
                        <p className={styles.pluginMeta}>
                          {plugin.version} · {plugin.runtime_type}
                        </p>
                        {hasUpdate && (
                          <p className={styles.pluginStatusLine}>
                            {t("settings.plugins.update_available", {
                              current: updateInfo?.current_version,
                              latest: updateInfo?.latest_version,
                            })}
                          </p>
                        )}
                      </div>
                    </div>

                    <label className={`${styles.pluginToggle} ${!isInstalled ? styles.pluginToggleDisabled : ""}`}>
                      <span className={`${styles.pluginStateBadge} ${styles[`pluginStateBadge${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
                        {currentState}
                      </span>
                      <button
                        type="button"
                        className={`${styles.pluginToggleTrack} ${isActive ? styles.pluginToggleTrackOn : ""}`}
                        onClick={() => void handleActivate(plugin.id, isActive)}
                        disabled={!isInstalled || isBusy || !configReady}
                        aria-label={isActive ? t("settings.plugins.deactivate") : t("settings.plugins.activate")}
                      >
                        <span className={`${styles.pluginToggleThumb} ${isActive ? styles.pluginToggleThumbOn : ""}`} />
                      </button>
                    </label>
                  </div>

                  <p className={`${styles.pluginDescription} ${!isInstalled ? styles.pluginContentDimmed : ""}`}>{plugin.description || "-"}</p>

                  <div className={`${styles.pluginCapabilities} ${!isInstalled ? styles.pluginContentDimmed : ""}`}>
                    {plugin.capabilities.map((capability) => (
                      <span key={capability} className={styles.pluginChip}>
                        {capability}
                      </span>
                    ))}
                  </div>

                  {installedRecord?.last_error && (
                    <p className={styles.pluginStatusLine}>{installedRecord.last_error}</p>
                  )}
                  {healthById[plugin.id] && (
                    <p className={styles.pluginStatusLine}>{healthById[plugin.id]}</p>
                  )}
                  {showConfig && requiredFields.some((field) => !field.configured) && (
                    <p className={styles.pluginStatusLine}>{t("settings.plugins.secret.required_hint")}</p>
                  )}

                  <div className={styles.pluginActions}>
                    {showConfig && (
                      <button
                        className={styles.pluginActionSecondary}
                        onClick={() => setExpandedConfigId(plugin.id)}
                        disabled={!isInstalled || isBusy}
                      >
                        <KeyRound size={14} />
                        <span>{t("settings.plugins.secret.configure")}</span>
                      </button>
                    )}
                    {canInstall && (
                      <button className={styles.pluginActionPrimary} onClick={() => void handleInstall(plugin.id)} disabled={isBusy}>
                        <Download size={14} />
                        <span>{isBusy ? t("common.loading") : installLabel}</span>
                      </button>
                    )}
                    <button className={styles.pluginActionSecondary} onClick={() => void handleHealth(plugin.id)} disabled={!isInstalled || isBusy}>
                      <HeartPulse size={14} />
                      <span>{t("settings.plugins.health")}</span>
                    </button>
                    {isInstalled && (
                      <button className={styles.pluginActionDanger} onClick={() => void handleUninstall(plugin.id)} disabled={isBusy}>
                        <Trash2 size={14} />
                        <span>{t("settings.plugins.uninstall")}</span>
                      </button>
                    )}
                  </div>

                </article>
              );
            })}

            {catalog.length === 0 && (
              <div className={styles.placeholderContent}>
                <ShieldCheck size={24} />
                <p>{t("settings.plugins.empty")}</p>
              </div>
            )}
          </div>
        </section>

        {unmanagedInstalled.length > 0 && (
          <section className={styles.settingsSection}>
            <div className={styles.sectionTitle}>
              <RefreshCw size={18} />
              <h3>{t("settings.plugins.installed_title")}</h3>
            </div>
            <div className={styles.pluginGrid}>
              {unmanagedInstalled.map((item) => (
                <article key={item.id} className={`${styles.pluginCard} ${styles.pluginCardMuted}`}>
                  <div className={styles.pluginCardTop}>
                    <div className={styles.pluginIdentity}>
                      <div className={styles.pluginIconShell}>
                        {item.manifest.icons?.svg || item.manifest.icons?.png ? (
                          <img
                            src={item.manifest.icons?.svg || item.manifest.icons?.png}
                            alt={item.manifest.name}
                            className={styles.pluginIconImage}
                          />
                        ) : (
                          <Blocks size={28} className={styles.pluginIconFallback} />
                        )}
                      </div>
                      <div className={styles.pluginHeading}>
                        <div className={styles.pluginTitleRow}>
                          <h4>{item.manifest.name}</h4>
                          <span className={`${styles.pluginStateBadge} ${styles.pluginStateBadgeInstalled}`}>{item.state}</span>
                        </div>
                        <p className={styles.pluginAuthor}>
                          {t("settings.plugins.author")}: {item.manifest.author || "-"}
                        </p>
                        <p className={styles.pluginMeta}>{item.id}</p>
                      </div>
                    </div>
                    <PlugZap size={18} className={styles.pluginOrphanIcon} />
                  </div>

                  <p className={styles.pluginDescription}>{item.manifest.description || "-"}</p>

                  <div className={styles.pluginActions}>
                    <button className={styles.pluginActionSecondary} onClick={() => void handleHealth(item.id)} disabled={busyId === item.id}>
                      <HeartPulse size={14} />
                      <span>{t("settings.plugins.health")}</span>
                    </button>
                    <button className={styles.pluginActionDanger} onClick={() => void handleUninstall(item.id)} disabled={busyId === item.id}>
                      <Trash2 size={14} />
                      <span>{t("settings.plugins.uninstall")}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {selectedConfigPlugin && (() => {
        const plugin = selectedConfigPlugin;
        return (
          <PluginConfigModal
            plugin={plugin}
            configStatus={configById[plugin.id]}
            busy={busyId === plugin.id}
            configDrafts={configDrafts[plugin.id] || {}}
            authDrafts={authDrafts[plugin.id] || {}}
            onClose={() => setExpandedConfigId(null)}
            onConfigDraftChange={(fieldKey, value) => setConfigDrafts((prev) => ({
              ...prev,
              [plugin.id]: {
                ...(prev[plugin.id] || {}),
                [fieldKey]: value,
              },
            }))}
            onConfigSave={(fieldKey) => void handleConfigSave(plugin.id, fieldKey)}
            onConfigDelete={(fieldKey) => void handleConfigDelete(plugin.id, fieldKey)}
            onAuthDraftChange={(fieldKey, value) => setAuthDrafts((prev) => ({
              ...prev,
              [plugin.id]: {
                ...(prev[plugin.id] || {}),
                [fieldKey]: value,
              },
            }))}
            onAuthAction={(actionId) => {
              const action = plugin.auth?.actions?.find((item) => item.id === actionId);
              if (action) {
                void handleAuthAction(plugin.id, action);
              }
            }}
            onDeleteAuthAction={(actionId) => {
              const action = plugin.auth?.actions?.find((item) => item.id === actionId);
              if (action) {
                void handleDeleteAuthAction(plugin.id, action);
              }
            }}
          />
        );
      })()}
    </div>
  );
}
