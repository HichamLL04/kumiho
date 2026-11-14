import { useEffect, useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { dangoIntegrationAPI } from "../../api/client";
import { Toast } from "../common/Toast";
import styles from "./SettingsComponents.module.css";

type IntegrationStatus = { endpoint: string; token_configured: boolean };

export function DangoIntegrationTab() {
  const [status, setStatus] = useState<IntegrationStatus>({ endpoint: "", token_configured: false });
  const [endpoint, setEndpoint] = useState("http://192.168.1.99:8787/api/v1/webhook/reading");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    dangoIntegrationAPI.get().then((value) => {
      if (!active) return;
      setStatus(value);
      if (value.endpoint) setEndpoint(value.endpoint);
    }).catch(() => {
      if (active) setToast({ type: "error", message: "Could not load Dango integration settings." });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await dangoIntegrationAPI.save({ endpoint: endpoint.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) });
      setStatus(next);
      setApiKey("");
      setToast({ type: "success", message: "Dango integration saved." });
    } catch {
      setToast({ type: "error", message: "Could not save Dango integration. Check the endpoint and API key." });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    setSaving(true);
    try {
      await dangoIntegrationAPI.revoke();
      setStatus({ endpoint: "", token_configured: false });
      setEndpoint("http://192.168.1.99:8787/api/v1/webhook/reading");
      setApiKey("");
      setToast({ type: "success", message: "Dango API key removed." });
    } catch {
      setToast({ type: "error", message: "Could not remove the Dango API key." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.tabContent}><Loader2 className="animate-spin" /></div>;

  return (
    <div className={styles.tabContent}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <div className={styles.tabHeader}>
        <h2>Dango reading sync</h2>
        <p className={styles.tabDescription}>Send completed manga chapters to your own Dango account. Your API key is encrypted in Kumiho and never shown again.</p>
      </div>
      <div className={styles.settingsSection}>
        <label htmlFor="dango-endpoint">Reading webhook endpoint</label>
        <input id="dango-endpoint" className={styles.settingsInput} type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://dango.example/api/v1/webhook/reading" />
        <label htmlFor="dango-api-key">Dango API key</label>
        <input id="dango-api-key" className={styles.settingsInput} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.token_configured ? "Saved key; leave blank to keep it" : "Paste your personal Dango API key"} />
        <p className={styles.tabDescription}>{status.token_configured ? "A key is saved for this Kumiho account." : "Create a separate Dango key for this Kumiho account in Dango → Connections → Reading API."} Matching uses AniList/MAL IDs in metadata.json or metadata.txt when available.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <button className={styles.tabHeaderAction} type="button" onClick={() => void save()} disabled={saving || !endpoint.trim() || (!status.token_configured && !apiKey.trim())}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save connection
          </button>
          {status.token_configured && <button className={styles.tabHeaderAction} type="button" onClick={() => void revoke()} disabled={saving}><Trash2 size={16} /> Remove key</button>}
        </div>
      </div>
    </div>
  );
}
