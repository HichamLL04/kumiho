import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Blocks, Download, HeartPulse, KeyRound, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { pluginAPI } from "../../api/client";
import type { PluginManifest, PluginRecord } from "../../types/plugin";
import { Toast } from "../common/Toast";
import styles from "./SettingsComponents.module.css";

type ToastState = { type: "success" | "error" | "info"; message: string } | null;

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

function supportsAPIKeyConfig(plugin: PluginManifest) {
  return plugin.id === "kumiho-plugin-metadata-googlebooks";
}

export function PluginsTab() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [healthById, setHealthById] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ToastState>(null);
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const [apiKeyDrafts, setAPIKeyDrafts] = useState<Record<string, string>>({});

  const installedById = useMemo(() => new Map(installed.map((item) => [item.id, item])), [installed]);
  const unmanagedInstalled = useMemo(
    () => installed.filter((item) => !catalog.some((plugin) => plugin.id === item.id)),
    [catalog, installed],
  );

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const [catalogRes, installedRes] = await Promise.all([pluginAPI.catalog(), pluginAPI.list()]);
      setCatalog(catalogRes.plugins || []);
      setInstalled(installedRes.plugins || []);
    } catch (error) {
      console.error("Failed to load plugin data:", error);
      setStatus({ type: "error", message: t("settings.plugins.toast.load_failed") });
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleConfigSave = (pluginId: string) => {
    const draft = apiKeyDrafts[pluginId]?.trim();
    if (!draft) {
      setStatus({ type: "info", message: t("settings.plugins.toast.api_key_required") });
      return;
    }
    setStatus({ type: "info", message: t("settings.plugins.toast.api_key_env_only") });
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
        <h2>{t("settings.plugins.title")}</h2>
        <p className={styles.tabDescription}>{t("settings.plugins.desc")}</p>
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
              const canInstall = !installedRecord || installedRecord.manifest.version !== plugin.version || installedRecord.state === "error";
              const installLabel = !installedRecord || installedRecord.manifest.version !== plugin.version
                ? t("settings.plugins.install")
                : t("settings.plugins.reinstall");
              const iconSrc = iconURL(plugin, installedRecord);
              const showConfig = supportsAPIKeyConfig(plugin);
              const isConfigOpen = expandedConfigId === plugin.id;

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
                        disabled={!isInstalled || isBusy}
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

                  <div className={styles.pluginActions}>
                    {showConfig && (
                      <button
                        className={styles.pluginActionSecondary}
                        onClick={() => setExpandedConfigId((prev) => (prev === plugin.id ? null : plugin.id))}
                        disabled={isBusy}
                      >
                        <KeyRound size={14} />
                        <span>{t("settings.plugins.api_key.configure")}</span>
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

                  {showConfig && isConfigOpen && (
                    <div className={styles.pluginConfigPanel}>
                      <div className={styles.pluginConfigHeader}>
                        <div>
                          <h5>{t("settings.plugins.api_key.title")}</h5>
                          <p>{t("settings.plugins.api_key.desc")}</p>
                        </div>
                        <span className={`${styles.pluginStateBadge} ${styles.pluginStateBadgeInstalled}`}>
                          {t("settings.plugins.api_key.restart_required")}
                        </span>
                      </div>

                      <label className={styles.pluginConfigField}>
                        <span>{t("settings.plugins.api_key.label")}</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={apiKeyDrafts[plugin.id] || ""}
                          onChange={(event) => setAPIKeyDrafts((prev) => ({ ...prev, [plugin.id]: event.target.value }))}
                          placeholder={t("settings.plugins.api_key.placeholder")}
                        />
                      </label>

                      <div className={styles.pluginConfigNotes}>
                        <p>{t("settings.plugins.api_key.current_mode")}</p>
                        <p>{t("settings.plugins.api_key.flow_hint")}</p>
                      </div>

                      <div className={styles.pluginConfigActions}>
                        <button
                          type="button"
                          className={styles.pluginActionPrimary}
                          onClick={() => handleConfigSave(plugin.id)}
                        >
                          <KeyRound size={14} />
                          <span>{t("settings.plugins.api_key.save")}</span>
                        </button>
                      </div>
                    </div>
                  )}
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
    </div>
  );
}
