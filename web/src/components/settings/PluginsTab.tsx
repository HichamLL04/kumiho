import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Blocks, Download, HeartPulse, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { pluginAPI } from "../../api/client";
import type { PluginManifest, PluginRecord } from "../../types/plugin";
import { Toast } from "../common/Toast";
import styles from "./SettingsComponents.module.css";

export function PluginsTab() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PluginManifest[]>([]);
  const [installed, setInstalled] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [healthById, setHealthById] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const installedById = useMemo(() => new Map(installed.map((item) => [item.id, item])), [installed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogRes, installedRes] = await Promise.all([pluginAPI.catalog(), pluginAPI.list()]);
      setCatalog(catalogRes.plugins || []);
      setInstalled(installedRes.plugins || []);
    } catch (error) {
      console.error("Failed to load plugin data:", error);
      setStatus({ type: "error", message: t("settings.plugins.toast.load_failed") });
    } finally {
      setLoading(false);
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
      await load();
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
      await load();
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
      if (active) {
        await pluginAPI.deactivate(pluginId);
      } else {
        await pluginAPI.activate(pluginId);
      }
      setStatus({ type: "success", message: active ? t("settings.plugins.toast.deactivated") : t("settings.plugins.toast.activated") });
      await load();
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
          <div className={styles.sectionContent}>
            {catalog.map((plugin) => {
              const installedRecord = installedById.get(plugin.id);
              const isActive = installedRecord?.state === "active";
              const isBusy = busyId === plugin.id;
              const canInstall = !installedRecord || installedRecord.manifest.version !== plugin.version || installedRecord.state === "error";
              const installLabel = !installedRecord
                ? t("settings.plugins.install")
                : installedRecord.manifest.version !== plugin.version
                  ? t("settings.plugins.reinstall")
                  : t("settings.plugins.reinstall");

              return (
                <div key={plugin.id} className={styles.settingsItem}>
                  <div className={styles.itemInfo}>
                    <label>{plugin.name}</label>
                    <p>{plugin.description}</p>
                    <p>
                      {plugin.version} · {plugin.runtime_type} · {plugin.capabilities.join(", ")}
                    </p>
                    {installedRecord && (
                      <p>
                        {t("settings.plugins.state")}: {installedRecord.state}
                        {installedRecord.last_error ? ` · ${installedRecord.last_error}` : ""}
                      </p>
                    )}
                    {healthById[plugin.id] && <p>{healthById[plugin.id]}</p>}
                  </div>

                  <div className={styles.itemControl} style={{ display: "grid", gap: "0.5rem" }}>
                    {canInstall && (
                      <button className={styles.settingsSelect} onClick={() => void handleInstall(plugin.id)} disabled={isBusy}>
                        <Download size={14} style={{ marginRight: "0.5rem" }} />
                        {isBusy ? t("common.loading") : installLabel}
                      </button>
                    )}
                    {installedRecord && (
                      <>
                        <button className={styles.settingsSelect} onClick={() => void handleActivate(plugin.id, isActive)} disabled={isBusy}>
                          <PlugZap size={14} style={{ marginRight: "0.5rem" }} />
                          {isActive ? t("settings.plugins.deactivate") : t("settings.plugins.activate")}
                        </button>
                        <button className={styles.settingsSelect} onClick={() => void handleHealth(plugin.id)} disabled={isBusy}>
                          <HeartPulse size={14} style={{ marginRight: "0.5rem" }} />
                          {t("settings.plugins.health")}
                        </button>
                        <button className={styles.settingsSelect} onClick={() => void handleUninstall(plugin.id)} disabled={isBusy}>
                          <Trash2 size={14} style={{ marginRight: "0.5rem" }} />
                          {t("settings.plugins.uninstall")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
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

        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <RefreshCw size={18} />
            <h3>{t("settings.plugins.installed_title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            {installed.length === 0 ? (
              <div className={styles.placeholderContent}>
                <p>{t("settings.plugins.installed_empty")}</p>
              </div>
            ) : (
              installed.map((item) => (
                <div key={item.id} className={styles.settingsItem}>
                  <div className={styles.itemInfo}>
                    <label>{item.manifest.name}</label>
                    <p>{item.id}</p>
                    <p>
                      {t("settings.plugins.state")}: {item.state}
                    </p>
                  </div>
                  <div className={styles.itemControl}>
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      <button className={styles.settingsSelect} onClick={() => void handleHealth(item.id)} disabled={busyId === item.id}>
                        {t("settings.plugins.health")}
                      </button>
                      <button className={styles.settingsSelect} onClick={() => void handleUninstall(item.id)} disabled={busyId === item.id}>
                        {t("settings.plugins.uninstall")}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
