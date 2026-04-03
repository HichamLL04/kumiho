import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Library, Users, Server, User, Settings, Monitor, BarChart3, Puzzle } from "lucide-react";
import { pluginAPI, systemAPI } from "../api/client";
import { UpdateBadge } from "../components/common/UpdateBadge";
import { Header } from "../components/headers/Header";
import { Sidebar } from "../components/Sidebar";
import { SubHeader } from "../components/headers/SubHeader";
import { useAuthStore } from "../stores/authStore";
import { GeneralTab } from "../components/settings/GeneralTab";
import { ViewerTab } from "../components/settings/ViewerTab";
import { LibrariesTab } from "../components/settings/LibrariesTab";
import { UsersTab } from "../components/settings/UsersTab";
import { SystemTab } from "../components/settings/SystemTab";
import { AccountTab } from "../components/settings/AccountTab";
import { StatisticsTab } from "../components/settings/StatisticsTab";
import { PluginsTab } from "../components/settings/PluginsTab";
import styles from "./Settings.module.css";

// 설정 탭 타입
type SettingsTab = "general" | "statistics" | "viewer" | "libraries" | "users" | "plugins" | "system" | "account";

// 탭 정보
const TABS: { id: SettingsTab; label: string; icon: typeof Library; adminOnly?: boolean }[] = [
  { id: "general", label: "settings.tabs.general", icon: Settings },
  { id: "statistics", label: "settings.tabs.statistics", icon: BarChart3 },
  { id: "viewer", label: "settings.tabs.viewer", icon: Monitor, adminOnly: true },
  { id: "libraries", label: "settings.tabs.libraries", icon: Library, adminOnly: true },
  { id: "users", label: "settings.tabs.users", icon: Users, adminOnly: true },
  { id: "plugins", label: "settings.tabs.plugins", icon: Puzzle, adminOnly: true },
  { id: "system", label: "settings.tabs.system", icon: Server, adminOnly: true },
  { id: "account", label: "settings.tabs.account", icon: User },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [hasSystemUpdate, setHasSystemUpdate] = useState(false);
  const [hasPluginUpdate, setHasPluginUpdate] = useState(false);

  // 사용자 역할에 따른 탭 필터링
  const availableTabs = TABS.filter((tab) => !tab.adminOnly || user?.role === "MASTER");
  const availableTabIds = useMemo(() => availableTabs.map((tab) => tab.id), [availableTabs]);

  const activeTab = useMemo<SettingsTab>(() => {
    if (availableTabs.length === 0) return "general";
    const requestedTab = searchParams.get("tab");
    const fallbackTab = availableTabs[0].id;
    if (requestedTab && availableTabIds.includes(requestedTab as SettingsTab)) {
      return requestedTab as SettingsTab;
    }
    return fallbackTab;
  }, [availableTabIds, availableTabs, searchParams]);

  useEffect(() => {
    if (availableTabs.length === 0) return;
    const requestedTab = searchParams.get("tab");
    if (requestedTab === activeTab) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", activeTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, availableTabs, searchParams, setSearchParams]);

  useEffect(() => {
    if (user?.role !== "MASTER") return undefined;

    const loadUpdates = async () => {
      try {
        const [systemInfo, pluginInfo] = await Promise.all([
          systemAPI.getVersion(),
          pluginAPI.getUpdates(),
        ]);
        setHasSystemUpdate(systemInfo.needs_update);
        setHasPluginUpdate(pluginInfo.has_updates);
      } catch (error) {
        console.error("Failed to load settings update state:", error);
      }
    };

    void loadUpdates();
    const interval = setInterval(loadUpdates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.role]);

  // 콘텐츠 렌더링
  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab />;
      case "statistics":
        return <StatisticsTab />;
      case "viewer":
        return <ViewerTab />;
      case "libraries":
        return <LibrariesTab />;
      case "users":
        return <UsersTab />;
      case "plugins":
        return <PluginsTab onUpdateStateChange={setHasPluginUpdate} />;
      case "system":
        return <SystemTab />;
      case "account":
        return <AccountTab />;
      default:
        return null;
    }
  };

  return (
    <div className={`${styles.settingsPage} page-with-sidebar ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* 서브헤더 */}
      <SubHeader title={t("settings.title")} />

      <div className={styles.settingsContainer}>
        <div className={styles.settingsContent}>
          {/* 사이드 네비게이션 */}
          <nav className={styles.settingsNav}>
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`${styles.navItem} ${activeTab === tab.id ? styles.active : ""}`}
                  aria-label={
                    (tab.id === "system" && hasSystemUpdate) || (tab.id === "plugins" && hasPluginUpdate)
                      ? `${t(tab.label)} - ${t("header.new_update_available")}`
                      : undefined
                  }
                  onClick={() => {
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set("tab", tab.id);
                    setSearchParams(nextParams);
                  }}
                >
                  <Icon size={18} />
                  <span>{t(tab.label)}</span>
                  {tab.id === "system" && hasSystemUpdate && (
                    <UpdateBadge
                      className={styles.navUpdateBadge}
                      ariaLabel={t("header.new_update_available")}
                    />
                  )}
                  {tab.id === "plugins" && hasPluginUpdate && (
                    <UpdateBadge
                      className={styles.navUpdateBadge}
                      ariaLabel={t("header.new_update_available")}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* 콘텐츠 영역 */}
          <div className={styles.settingsPanel}>{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
