import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Link2, Link2Off, ExternalLink, CheckCircle, XCircle, Loader } from "lucide-react";
import { syncAPI } from "../../api/client";
import type { SyncStatus } from "../../api/client";
import { Toast } from "../common/Toast";
import commonStyles from "./SettingsComponents.module.css";
import styles from "./SyncTab.module.css";

export function SyncTab() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // AniList state
  const [anilistClientId, setAnilistClientId] = useState("");
  const [anilistClientSecret, setAnilistClientSecret] = useState("");
  const [anilistLoading, setAnilistLoading] = useState(false);

  // MAL state
  const [malClientId, setMalClientId] = useState("");
  const [malClientSecret, setMalClientSecret] = useState("");
  const [malLoading, setMalLoading] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
  };

  const loadStatus = useCallback(async () => {
    try {
      const data = await syncAPI.getStatus();
      setStatus(data);
      if (data.anilist.client_id) setAnilistClientId(data.anilist.client_id);
      if (data.anilist.client_secret) setAnilistClientSecret(data.anilist.client_secret);
      if (data.mal.client_id) setMalClientId(data.mal.client_id);
      if (data.mal.client_secret) setMalClientSecret(data.mal.client_secret);
    } catch {
      showToast("error", "No se pudo cargar el estado de sincronización.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Listen for OAuth success messages from popups
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "ANILIST_AUTH_SUCCESS") {
        showToast("success", "¡Cuenta de AniList vinculada correctamente!");
        void loadStatus();
      }
      if (event.data?.type === "MAL_AUTH_SUCCESS") {
        showToast("success", "¡Cuenta de MyAnimeList vinculada correctamente!");
        void loadStatus();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadStatus]);

  // ── AniList ──────────────────────────────────────────────────────────

  const handleConnectAniList = async () => {
    if (!anilistClientId.trim()) {
      showToast("error", "Introduce el Client ID de AniList.");
      return;
    }
    setAnilistLoading(true);
    try {
      await syncAPI.saveAniListCredentials(anilistClientId.trim(), anilistClientSecret.trim());
      const token = localStorage.getItem("access_token");
      const baseAuthorizeUrl = syncAPI.getAniListAuthorizeUrl();
      const authorizeUrl = token ? `${baseAuthorizeUrl}?token=${token}` : baseAuthorizeUrl;
      const w = 620, h = 720;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      window.open(authorizeUrl, "AniList Auth", `width=${w},height=${h},left=${left},top=${top},status=no`);
    } catch {
      showToast("error", "No se pudo iniciar la autorización de AniList.");
    } finally {
      setAnilistLoading(false);
    }
  };

  const handleDisconnectAniList = async () => {
    setAnilistLoading(true);
    try {
      await syncAPI.disconnectAniList();
      showToast("success", "Cuenta de AniList desvinculada.");
      await loadStatus();
    } finally {
      setAnilistLoading(false);
    }
  };

  // ── MyAnimeList ───────────────────────────────────────────────────────

  const handleConnectMAL = async () => {
    if (!malClientId.trim()) {
      showToast("error", "Introduce el Client ID de MyAnimeList.");
      return;
    }
    setMalLoading(true);
    try {
      await syncAPI.saveMALCredentials(malClientId.trim(), malClientSecret.trim());
      const token = localStorage.getItem("access_token");
      const baseAuthorizeUrl = syncAPI.getMALAuthorizeUrl();
      const authorizeUrl = token ? `${baseAuthorizeUrl}?token=${token}` : baseAuthorizeUrl;
      const w = 620, h = 720;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      window.open(authorizeUrl, "MAL Auth", `width=${w},height=${h},left=${left},top=${top},status=no`);
    } catch {
      showToast("error", "No se pudo iniciar la autorización de MyAnimeList.");
    } finally {
      setMalLoading(false);
    }
  };

  const handleDisconnectMAL = async () => {
    setMalLoading(true);
    try {
      await syncAPI.disconnectMAL();
      showToast("success", "Cuenta de MyAnimeList desvinculada.");
      await loadStatus();
    } finally {
      setMalLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={commonStyles.placeholderContent}>
        <Loader size={28} className={commonStyles.loadingSpinner} />
        <span>Cargando...</span>
      </div>
    );
  }

  const anilistCallbackUrl = `${window.location.protocol}//${window.location.host}/api/v1/sync/anilist/callback`;
  const malCallbackUrl = `${window.location.protocol}//${window.location.host}/api/v1/sync/mal/callback`;

  return (
    <div className={styles.syncContainer}>
      {toast && (
        <div style={{ position: "fixed", top: "2rem", right: "2rem", zIndex: 9999 }}>
          <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
        </div>
      )}

      <div className={commonStyles.tabHeader}>
        <h2>Sincronización de Cuentas</h2>
        <p className={commonStyles.tabDescription}>
          Vincula tu cuenta de AniList o MyAnimeList para registrar automáticamente tu progreso de lectura.
        </p>
      </div>

      <div className={commonStyles.settingsSections}>

        {/* ── AniList ── */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <RefreshCw size={18} />
            <h3>AniList</h3>
          </div>

          <div className={`${styles.integrationCard} ${status?.anilist.connected ? styles.connected : ""}`}>
            {/* Header */}
            <div className={styles.cardHeader}>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>AniList</span>
                <span className={`${styles.serviceStatus} ${status?.anilist.connected ? styles.statusConnected : styles.statusDisconnected}`}>
                  {status?.anilist.connected ? (
                    <><CheckCircle size={12} /> Conectado</>
                  ) : (
                    <><XCircle size={12} /> Desconectado</>
                  )}
                </span>
              </div>
              {status?.anilist.connected && (
                <div className={styles.userBadge}>
                  {status.anilist.avatar && (
                    <img src={status.anilist.avatar} alt="avatar" className={styles.avatar} />
                  )}
                  <span className={styles.username}>{status.anilist.username}</span>
                </div>
              )}
            </div>

            {/* Body */}
            {!status?.anilist.connected ? (
              <div className={styles.cardBody}>
                <div className={styles.credentialsRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Client ID</label>
                    <input
                      type="text"
                      value={anilistClientId}
                      onChange={(e) => setAnilistClientId(e.target.value)}
                      placeholder="Tu Client ID de AniList..."
                      className={commonStyles.settingsInput}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Client Secret <span className={styles.optional}>(opcional)</span></label>
                    <input
                      type="password"
                      value={anilistClientSecret}
                      onChange={(e) => setAnilistClientSecret(e.target.value)}
                      placeholder="Client Secret..."
                      className={commonStyles.settingsInput}
                    />
                  </div>
                </div>

                <button
                  onClick={() => void handleConnectAniList()}
                  disabled={anilistLoading}
                  className={`${styles.connectButton} ${styles.connectButtonFull} ${styles.anilistButton}`}
                >
                  {anilistLoading ? <Loader size={16} className={commonStyles.loadingSpinner} /> : <Link2 size={16} />}
                  Iniciar sesión con AniList
                </button>

                <div className={styles.callbackBox}>
                  <p className={styles.helpText}>
                    Registra tu app en{" "}
                    <a href="https://anilist.co/settings/developer" target="_blank" rel="noopener noreferrer" className={styles.helpLink}>
                      AniList → Ajustes → Desarrollador <ExternalLink size={12} />
                    </a>
                    {" "}y usa esta URL como <strong>Redirect URL</strong>:
                  </p>
                  <code className={styles.callbackCode}>{anilistCallbackUrl}</code>
                </div>
              </div>
            ) : (
              <div className={styles.cardFooter}>
                <button
                  onClick={() => void handleDisconnectAniList()}
                  disabled={anilistLoading}
                  className={styles.disconnectButton}
                >
                  {anilistLoading ? <Loader size={16} className={commonStyles.loadingSpinner} /> : <Link2Off size={16} />}
                  Desconectar AniList
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── MyAnimeList ── */}
        <section className={commonStyles.settingsSection}>
          <div className={commonStyles.sectionTitle}>
            <RefreshCw size={18} />
            <h3>MyAnimeList</h3>
          </div>

          <div className={`${styles.integrationCard} ${status?.mal.connected ? styles.connected : ""}`}>
            {/* Header */}
            <div className={styles.cardHeader}>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>MyAnimeList</span>
                <span className={`${styles.serviceStatus} ${status?.mal.connected ? styles.statusConnected : styles.statusDisconnected}`}>
                  {status?.mal.connected ? (
                    <><CheckCircle size={12} /> Conectado</>
                  ) : (
                    <><XCircle size={12} /> Desconectado</>
                  )}
                </span>
              </div>
              {status?.mal.connected && (
                <div className={styles.userBadge}>
                  {status.mal.avatar && (
                    <img src={status.mal.avatar} alt="avatar" className={styles.avatar} />
                  )}
                  <span className={styles.username}>{status.mal.username}</span>
                </div>
              )}
            </div>

            {/* Body */}
            {!status?.mal.connected ? (
              <div className={styles.cardBody}>
                <div className={styles.credentialsRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Client ID</label>
                    <input
                      type="text"
                      value={malClientId}
                      onChange={(e) => setMalClientId(e.target.value)}
                      placeholder="Tu Client ID de MAL..."
                      className={commonStyles.settingsInput}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Client Secret <span className={styles.optional}>(opcional)</span></label>
                    <input
                      type="password"
                      value={malClientSecret}
                      onChange={(e) => setMalClientSecret(e.target.value)}
                      placeholder="Client Secret..."
                      className={commonStyles.settingsInput}
                    />
                  </div>
                </div>

                <button
                  onClick={() => void handleConnectMAL()}
                  disabled={malLoading}
                  className={`${styles.connectButton} ${styles.connectButtonFull}`}
                >
                  {malLoading ? <Loader size={16} className={commonStyles.loadingSpinner} /> : <Link2 size={16} />}
                  Iniciar sesión con MyAnimeList
                </button>

                <div className={styles.callbackBox}>
                  <p className={styles.helpText}>
                    Registra tu aplicación en{" "}
                    <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noopener noreferrer" className={styles.helpLink}>
                      MAL API Config <ExternalLink size={12} />
                    </a>
                    {" "}y usa esta URL como <strong>Redirect URL</strong>:
                  </p>
                  <code className={styles.callbackCode}>{malCallbackUrl}</code>
                </div>
              </div>
            ) : (
              <div className={styles.cardFooter}>
                <button
                  onClick={() => void handleDisconnectMAL()}
                  disabled={malLoading}
                  className={styles.disconnectButton}
                >
                  {malLoading ? <Loader size={16} className={commonStyles.loadingSpinner} /> : <Link2Off size={16} />}
                  Desconectar MyAnimeList
                </button>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
