import { useState, type FormEvent } from "react";
import type { MemoryId } from "@/domain/memory";
import type {
  AppSettings,
  AssetSearchEngine,
  LanguagePreference,
  ProviderType,
  ThemePreference,
  WebSearchEngine,
} from "@/domain/settings";
import { normalizeSettings } from "@/domain/settings";
import { useApplication } from "../runtime";
import { Icon } from "../icons";
import { dictionary, resolveLanguage } from "../i18n";

export function SettingsPanel({ onClose }: { readonly onClose: () => void }) {
  const { database, runtime, refreshServices } = useApplication();
  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings(database.settings));
  const [tab, setTab] = useState<"model" | "research" | "appearance" | "memory">("model");
  const [saving, setSaving] = useState(false);
  const t = dictionary(resolveLanguage(settings.system.language));
  const officialModel = settings.ai.apiType === "official";

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await runtime.session.updateSettings(settings);
    setSaving(false);
    if (result.ok) {
      refreshServices();
      onClose();
    }
  }

  return (
    <div className="ob-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="ob-settings" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2>{t.settings.title}</h2><button type="button" className="ob-icon-button" onClick={onClose}><Icon name="close" /></button></header>
        <div className="ob-settings-body">
          <nav className="ob-settings-tabs">
            {(["model", "research", "appearance", "memory"] as const).map((name) => (
              <button type="button" className={tab === name ? "is-active" : ""} onClick={() => setTab(name)} key={name}>
                {t.settings.tabs[name]}
              </button>
            ))}
          </nav>
          <section className="ob-settings-content">
            {tab === "model" ? (
              <>
                <Field label={t.settings.provider}>
                  <select
                    value={settings.ai.apiType}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        ai: { ...settings.ai, apiType: event.target.value as ProviderType },
                      })
                    }
                  >
                    <option value="official">{t.settings.officialModel}</option>
                    <option value="openai-compatible">{t.settings.openAiCompatible}</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </Field>
                {officialModel ? (
                  <div className="ob-settings-note">
                    <strong>{t.settings.officialModel}</strong>
                    <p>{t.settings.officialModelHelp}</p>
                  </div>
                ) : (
                  <>
                    <Field label={t.settings.apiBaseUrl}>
                      <input value={settings.ai.apiBaseUrl} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, apiBaseUrl: event.target.value } })} />
                    </Field>
                    <Field label={t.settings.apiKey}>
                      <input type="password" autoComplete="off" value={settings.ai.apiKey} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, apiKey: event.target.value } })} />
                    </Field>
                    <Field label={t.settings.model}>
                      <input value={settings.ai.model} onChange={(event) => setSettings({ ...settings, ai: { ...settings.ai, model: event.target.value } })} />
                    </Field>
                  </>
                )}
              </>
            ) : null}
            {tab === "research" ? (
              <>
                <Field label={t.settings.webSearch}>
                  <select value={settings.webSearch.engine} onChange={(event) => setSettings({ ...settings, webSearch: { ...settings.webSearch, engine: event.target.value as WebSearchEngine } })}>
                    <option value="disabled">{t.settings.disabled}</option><option value="builtin">{t.settings.modelBuiltin}</option><option value="tavily">Tavily</option><option value="firecrawl">Firecrawl</option>
                  </select>
                </Field>
                {settings.webSearch.engine === "tavily" ? <Field label={t.settings.tavilyApiKey}><input type="password" value={settings.webSearch.tavilyApiKey} onChange={(event) => setSettings({ ...settings, webSearch: { ...settings.webSearch, tavilyApiKey: event.target.value } })} /></Field> : null}
                {settings.webSearch.engine === "firecrawl" ? <Field label={t.settings.firecrawlApiKey}><input type="password" value={settings.webSearch.firecrawlApiKey} onChange={(event) => setSettings({ ...settings, webSearch: { ...settings.webSearch, firecrawlApiKey: event.target.value } })} /></Field> : null}
                <Field label={t.settings.imageSearch}>
                  <select value={settings.assetSearch.engine} onChange={(event) => setSettings({ ...settings, assetSearch: { ...settings.assetSearch, engine: event.target.value as AssetSearchEngine } })}>
                    <option value="official">{t.settings.officialImageSearch}</option><option value="disabled">{t.settings.disabled}</option><option value="pixabay">Pixabay</option><option value="unsplash">Unsplash</option><option value="pexels">Pexels</option>
                  </select>
                </Field>
                {settings.assetSearch.engine === "official" ? <div className="ob-callout"><strong>{t.settings.officialImageSearch}</strong><p>{t.settings.officialImageSearchHelp}</p></div> : null}
                {settings.assetSearch.engine === "pixabay" ? <Field label={t.settings.pixabayApiKey}><input type="password" value={settings.assetSearch.pixabayApiKey} onChange={(event) => setSettings({ ...settings, assetSearch: { ...settings.assetSearch, pixabayApiKey: event.target.value } })} /></Field> : null}
                {settings.assetSearch.engine === "unsplash" ? <Field label={t.settings.unsplashApiKey}><input type="password" value={settings.assetSearch.unsplashApiKey} onChange={(event) => setSettings({ ...settings, assetSearch: { ...settings.assetSearch, unsplashApiKey: event.target.value } })} /></Field> : null}
                {settings.assetSearch.engine === "pexels" ? <Field label={t.settings.pexelsApiKey}><input type="password" value={settings.assetSearch.pexelsApiKey} onChange={(event) => setSettings({ ...settings, assetSearch: { ...settings.assetSearch, pexelsApiKey: event.target.value } })} /></Field> : null}
              </>
            ) : null}
            {tab === "appearance" ? (
              <>
                <Field label={t.settings.language}><select value={settings.system.language} onChange={(event) => setSettings({ ...settings, system: { ...settings.system, language: event.target.value as LanguagePreference } })}><option value="system">{t.settings.system}</option><option value="zh">{t.settings.chinese}</option><option value="en">{t.settings.english}</option></select></Field>
                <Field label={t.settings.theme}><select value={settings.system.theme} onChange={(event) => setSettings({ ...settings, system: { ...settings.system, theme: event.target.value as ThemePreference } })}><option value="system">{t.settings.system}</option><option value="light">{t.settings.light}</option><option value="dark">{t.settings.dark}</option></select></Field>
              </>
            ) : null}
            {tab === "memory" ? (
              <>
                <label className="ob-toggle"><input type="checkbox" checked={settings.privacy.memoryEnabled} onChange={(event) => setSettings({ ...settings, privacy: { memoryEnabled: event.target.checked } })} />{t.settings.memoryEnabled}</label>
                <p className="ob-help">{t.settings.memoryHelp}</p>
                <div className="ob-memory-list">
                  {database.memories.map((memory) => (
                    <div key={memory.id}><span><small>{memory.category}</small>{memory.content}</span><button type="button" onClick={() => void runtime.session.applyMemoryOperations([{ type: "delete", id: memory.id as MemoryId }])}>{t.settings.delete}</button></div>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>
        <footer><button type="button" className="ob-secondary-button" onClick={onClose}>{t.settings.cancel}</button><button className="ob-primary-button" disabled={saving}>{saving ? t.settings.saving : t.settings.save}</button></footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return <label className="ob-field"><span>{label}</span>{children}</label>;
}
