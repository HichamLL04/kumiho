export interface PluginArtifact {
  platform: string;
  url: string;
  checksum: string;
  signature?: string;
}

export interface PluginIcons {
  svg?: string;
  png?: string;
}

export type PluginLocalizedString = Record<string, string>;

export interface PluginConfigSchemaField {
  key: string;
  type: string;
  label: string;
  label_i18n?: PluginLocalizedString;
  description?: string;
  description_i18n?: PluginLocalizedString;
  required?: boolean;
  default?: unknown;
  env_key?: string;
  placeholder?: string;
  placeholder_i18n?: PluginLocalizedString;
  auto_complete?: string;
  options?: string[];
}

export interface PluginConfigSchema {
  version: string;
  fields: PluginConfigSchemaField[];
}

export interface PluginAuthAction {
  id: string;
  type: string;
  title: string;
  title_i18n?: PluginLocalizedString;
  description?: string;
  description_i18n?: PluginLocalizedString;
  button_label?: string;
  button_label_i18n?: PluginLocalizedString;
  repeat_label?: string;
  repeat_label_i18n?: PluginLocalizedString;
  delete_label?: string;
  delete_label_i18n?: PluginLocalizedString;
  fields: PluginConfigSchemaField[];
  endpoint?: string;
  params?: Record<string, string>;
  store_mappings?: Record<string, string>;
  required_message?: string;
  required_message_i18n?: PluginLocalizedString;
  success_message?: string;
  success_message_i18n?: PluginLocalizedString;
  success_reactivate_message?: string;
  success_reactivate_message_i18n?: PluginLocalizedString;
  error_message?: string;
  error_message_i18n?: PluginLocalizedString;
  error_messages?: Record<string, string>;
  error_messages_i18n?: Record<string, PluginLocalizedString>;
  delete_message?: string;
  delete_message_i18n?: PluginLocalizedString;
  delete_reactivate_message?: string;
  delete_reactivate_message_i18n?: PluginLocalizedString;
  delete_error_message?: string;
  delete_error_message_i18n?: PluginLocalizedString;
  delete_error_messages?: Record<string, string>;
  delete_error_messages_i18n?: Record<string, PluginLocalizedString>;
}

export interface PluginAuthSchema {
  actions?: PluginAuthAction[];
}

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  icons?: PluginIcons;
  homepage?: string;
  repository?: string;
  license?: string;
  trust_level?: string;
  runtime_type: string;
  supported_platforms?: string[];
  capabilities: string[];
  permissions?: string[];
  min_core_version?: string;
  max_core_version?: string;
  sdk_version?: string;
  config_schema_version?: string;
  config_schema?: PluginConfigSchema;
  auth?: PluginAuthSchema;
  artifacts?: PluginArtifact[] | null;
}

export interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  state: string;
  install_path?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface PluginConfigFieldStatus {
  key: string;
  type: string;
  required: boolean;
  configured: boolean;
  source?: string;
  masked_hint?: string;
}

export interface PluginConfigStatus {
  plugin_id: string;
  fields: PluginConfigFieldStatus[];
}

export interface PluginConfigUpdateResponse {
  config: PluginConfigStatus;
  reactivation_required: boolean;
  message: string;
}

export interface PluginAuthActionResponse extends PluginConfigUpdateResponse {
  expires_in?: number;
  token_type?: string;
}

export interface PluginAuthDeleteResponse {
  config: PluginConfigStatus;
  message: string;
  deleted: boolean;
  plugin_id: string;
  reactivation_required?: boolean;
}

export interface PluginCatalogResponse {
  plugins: PluginManifest[];
}

export interface PluginUpdateItem {
  plugin_id: string;
  name: string;
  current_version: string;
  latest_version?: string;
  update_available: boolean;
}

export interface PluginUpdateSummary {
  has_updates: boolean;
  count: number;
  plugins: PluginUpdateItem[];
}

export interface PluginInstallResponse {
  record: PluginRecord;
  artifact_url: string;
  install_path: string;
  restart_required: boolean;
}

export interface PluginUninstallResponse {
  plugin_id: string;
  removed: boolean;
}

export interface MetadataSourceRef {
  id: string;
  name: string;
  url?: string;
}

export interface MetadataSearchCandidate {
  source: MetadataSourceRef;
  title: string;
  original_title?: string;
  authors?: string[];
  description?: string;
  content_type?: string;
  year?: number;
  cover_url?: string;
  score: number;
  confidence: number;
  reason?: string;
}

export interface MetadataCandidateItem {
  plugin_id: string;
  plugin_name: string;
  candidate: MetadataSearchCandidate;
}

export interface MetadataSearchResult {
  query: {
    local_title?: string;
    filename?: string;
    series_name?: string;
    volume_number?: number;
    chapter_number?: number;
    language?: string;
    author_hint?: string;
    content_type?: string;
    identifiers?: Record<string, string>;
    limit?: number;
  };
  candidates: MetadataCandidateItem[];
  failures?: { plugin_id: string; plugin_name: string; message: string }[];
}

export interface MetadataSearchRequest {
  title?: string;
}

export interface MetadataResult {
  source: MetadataSourceRef;
  title: string;
  original_title?: string;
  authors?: string[];
  description?: string;
  tags?: string[];
  content_type?: string;
  language?: string;
  publication_date?: string;
  publisher?: string;
  identifiers?: Record<string, string>;
  series_name?: string;
  volume_number?: number;
  cover?: {
    url: string;
    width?: number;
    height?: number;
  };
}

export interface MetadataFetchResponse {
  plugin_id: string;
  result: MetadataResult;
}

export interface MetadataApplyResponse {
  series: import("./series").Series;
  updated_fields: string[];
  cover_url?: string;
  applied_at: string;
}
