import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { rpc } from "~/lib/rpc";
import type { AutomationJob, AutomationTemplate, InstalledSkill, MarketSkill } from "~/lib/types";
import { useSkills } from "~/hooks/useApi";
import { Icon } from "./Icons";
import { usePrefs } from "~/hooks/usePrefs";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";

type Kind = "plugins" | "skills" | "automations";

function permBits(p?: InstalledSkill["manifest"]["permissions"]) {
  if (!p) return [] as string[];
  return [
    p.shell && "shell",
    p.network && "net",
    p.filesystem && "fs",
    p.git && "git",
  ].filter(Boolean) as string[];
}

function isPlugin(s: MarketSkill) {
  return s.kind === "plugin";
}

function humanSeconds(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Extensions: one card per thing to put on the machine — a mark, its name
// and who made it, what it does, and the one action at its top right.
function ExtCard({ icon, name, sub, desc, action, children, installed }: {
  icon: Parameters<typeof Icon>[0]["name"]; name: string; sub?: string; desc: string;
  action?: ReactNode; children?: ReactNode; installed?: boolean;
}) {
  return (
    <article className={`ext-card${installed ? " installed" : ""}`}>
      <div className="ext-card-top">
        <div className="ext-icon"><Icon name={icon} size={18} /></div>
        <div className="ext-name">
          <strong>{name}</strong>
          {sub && <span>{sub}</span>}
        </div>
        {action}
      </div>
      <p className="ext-desc">{desc}</p>
      {children}
    </article>
  );
}

export function SkillMarket({ onBack }: { onBack?: () => void } = {}) {
  const { skills, reload: reloadSkills } = useSkills();
  const { lang } = usePrefs();
  const [kind, setKind] = useState<Kind>("plugins");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<MarketSkill[]>([]);
  const [searching, setSearching] = useState(false);

  // --- Automation state ---
  const [automCatalog, setAutomCatalog] = useState<AutomationTemplate[]>([]);
  const [automJobs, setAutomJobs] = useState<AutomationJob[]>([]);
  const [automBusy, setAutomBusy] = useState<Record<string, boolean>>({});
  const [automLoading, setAutomLoading] = useState(false);

  const loadAutomations = useCallback(async () => {
    setAutomLoading(true);
    try {
      const [tmplRes, jobsRes] = await Promise.all([
        rpc<AutomationTemplate[]>("automation.catalog", {}),
        rpc<AutomationJob[]>("automation.list", {}),
      ]);
      setAutomCatalog(tmplRes ?? []);
      setAutomJobs(jobsRes ?? []);
    } finally {
      setAutomLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kind === "automations") void loadAutomations();
  }, [kind, loadAutomations]);

  const handleInstall = useCallback(async (name: string) => {
    setAutomBusy((b) => ({ ...b, [name]: true }));
    try {
      await rpc("automation.install", { name });
      await loadAutomations();
    } finally {
      setAutomBusy((b) => ({ ...b, [name]: false }));
    }
  }, [loadAutomations]);

  const handleUninstall = useCallback(async (name: string) => {
    setAutomBusy((b) => ({ ...b, [name]: true }));
    try {
      await rpc("automation.uninstall", { name });
      await loadAutomations();
    } finally {
      setAutomBusy((b) => ({ ...b, [name]: false }));
    }
  }, [loadAutomations]);

  const handleToggle = useCallback(async (job: AutomationJob) => {
    setAutomBusy((b) => ({ ...b, [job.name]: true }));
    try {
      await rpc("automation.upsert", { ...job, enabled: !job.enabled });
      await loadAutomations();
    } finally {
      setAutomBusy((b) => ({ ...b, [job.name]: false }));
    }
  }, [loadAutomations]);

  // --- Skill/plugin state ---
  const [skillBusy, setSkillBusy] = useState<Record<string, boolean>>({});

  // Putting a catalog entry on the machine, and taking it off again. The
  // name is the identity on both sides, so the card can say which it is
  // without holding anything of its own.
  const installSkill = useCallback(async (name: string) => {
    setSkillBusy((b) => ({ ...b, [name]: true }));
    try {
      await rpc("skill.install", { name });
      await reloadSkills();
    } catch (e) {
      toast(String((e as Error)?.message ?? e));
    } finally {
      setSkillBusy((b) => ({ ...b, [name]: false }));
    }
  }, [reloadSkills]);

  const removeSkill = useCallback(async (name: string) => {
    setSkillBusy((b) => ({ ...b, [name]: true }));
    try {
      await rpc("skill.uninstall", { name });
      await reloadSkills();
    } catch (e) {
      toast(String((e as Error)?.message ?? e));
    } finally {
      setSkillBusy((b) => ({ ...b, [name]: false }));
    }
  }, [reloadSkills]);

  const search = useCallback(async (q = query) => {
    setSearching(true);
    try {
      const results = await rpc<MarketSkill[]>("market.list", { q });
      setCatalog(results ?? []);
    } catch {
      setCatalog([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    void search("");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const installedFiltered = useMemo(() => {
    if (!q) return skills;
    return skills.filter((s) =>
      `${s.manifest.name} ${s.manifest.description}`.toLowerCase().includes(q),
    );
  }, [skills, q]);

  const plugins = useMemo(
    () => catalog.filter((s) => isPlugin(s) && (!q || `${s.manifest.name} ${s.manifest.description}`.toLowerCase().includes(q))),
    [catalog, q],
  );
  const marketSkills = useMemo(
    () => catalog.filter((s) => !isPlugin(s) && (!q || `${s.manifest.name} ${s.manifest.description} ${s.plugin ?? ""}`.toLowerCase().includes(q))),
    [catalog, q],
  );

  const skillGroups = useMemo(() => {
    const map = new Map<string, MarketSkill[]>();
    for (const s of marketSkills) {
      const key = s.plugin || "other";
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [marketSkills]);

  const installedNames = useMemo(
    () => new Set(skills.map((s: InstalledSkill) => s.manifest.name)),
    [skills],
  );

  // the one action a catalog card offers: put it on, or take it off
  const cardAction = (name: string) => {
    const on = installedNames.has(name);
    const busy = skillBusy[name];
    return (
      <button
        type="button"
        className={`catalog-act${on ? " on" : ""}`}
        disabled={busy}
        title={on ? t("remove", lang) : undefined}
        onClick={() => void (on ? removeSkill(name) : installSkill(name))}
      >
        {/* an installed one reads as done; hovering it offers the removal */}
        {busy ? t("installing", lang) : on ? (
          <>
            <span className="act-done"><Icon name="check" size={12} /> {t("extInstalled", lang)}</span>
            <span className="act-undo">{t("remove", lang)}</span>
          </>
        ) : t("install", lang)}
      </button>
    );
  };

  // Installed jobs lookup by name
  const jobByName = useMemo(() => {
    const m = new Map<string, AutomationJob>();
    for (const j of automJobs) m.set(j.name.toLowerCase(), j);
    return m;
  }, [automJobs]);

  return (
    <div className="catalog">
      <header className="catalog-head">
        {onBack && (
          <button type="button" className="market-back" onClick={onBack}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 5l-7 7 7 7" /></svg>
            {t("back", lang)}
          </button>
        )}
        <div className="ext-hero">
          <div className="ext-hero-text">
            <h1>{t("marketplace", lang)}</h1>
            <p>{t("extLead", lang)}</p>
          </div>
          {kind !== "automations" && (
            <div className="catalog-search">
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
                placeholder={t("search", lang)}
              />
            </div>
          )}
        </div>
        <nav className="ext-tabs" role="tablist">
          {([["plugins", "box"], ["skills", "skills"], ["automations", "lightning"]] as const).map(([k, icon]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              <Icon name={icon} size={13} /> {t(k, lang)}
            </button>
          ))}
        </nav>
      </header>

      <div className="catalog-body">
        {kind === "plugins" && (
          <>
            <div className="catalog-meta">
              {t("catalogLabel", lang)} · {plugins.length}{searching ? ` · ${t("searching", lang)}` : ""}
              {installedFiltered.length > 0 ? ` · ${t("installed", lang)} ${installedFiltered.length}` : ""}
            </div>
            {plugins.length === 0 && !searching ? (
              <div className="empty">
                <strong>{t("noPlugins", lang)}</strong>
                <p>{t("noPluginsHint", lang)}</p>
              </div>
            ) : (
              <div className="catalog-grid">
                {plugins.map((s: MarketSkill) => (
                  <ExtCard
                    key={s.manifest.name}
                    icon="box"
                    name={s.manifest.name}
                    sub={`${s.manifest.author || "rovecode"} · v${s.manifest.version}`}
                    desc={s.manifest.description || t("noDescription", lang)}
                    installed={installedNames.has(s.manifest.name)}
                    action={cardAction(s.manifest.name)}
                  />
                ))}
              </div>
            )}
            {installedFiltered.length > 0 && (
              <div className="catalog-meta" style={{ marginTop: 18 }}>{t("installed", lang)} · {installedFiltered.length}</div>
            )}
            {installedFiltered.length > 0 && (
              <div className="catalog-grid">
                {installedFiltered.map((s: InstalledSkill) => (
                  <ExtCard
                    key={s.manifest.name}
                    icon="box"
                    name={s.manifest.name}
                    sub={`v${s.manifest.version}`}
                    desc={s.manifest.description || t("noDescription", lang)}
                    installed
                    action={cardAction(s.manifest.name)}
                  >
                    {permBits(s.manifest.permissions).length > 0 && (
                      <div className="ext-tags">
                        {permBits(s.manifest.permissions).map((b) => <span key={b} className="ext-tag warn">{b}</span>)}
                      </div>
                    )}
                  </ExtCard>
                ))}
              </div>
            )}
          </>
        )}

        {kind === "skills" && (
          <>
            <div className="catalog-meta">
              {t("marketplace", lang)} · {marketSkills.length}{searching ? ` · ${t("searching", lang)}` : ""}
            </div>
            {marketSkills.length === 0 && !searching ? (
              <div className="empty">
                <strong>{t("marketBrowse", lang)}</strong>
                <p>{t("marketBrowseHint", lang)}</p>
              </div>
            ) : (
              skillGroups.map(([plugin, items]) => (
                <section key={plugin} className="catalog-group">
                  <div className="catalog-meta">{plugin} · {items.length}</div>
                  <div className="catalog-grid">
                    {items.map((s: MarketSkill) => (
                      <ExtCard
                        key={s.manifest.name}
                        icon="skills"
                        name={s.manifest.name}
                        sub={`v${s.manifest.version}${s.signed ? ` · ${t("signed", lang)}` : ""}`}
                        desc={s.manifest.description || t("noDescription", lang)}
                        installed={installedNames.has(s.manifest.name)}
                        action={cardAction(s.manifest.name)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}

        {kind === "automations" && (
          <>
            {/* ── Catalog ── */}
            <div className="catalog-meta" style={{ marginBottom: 6 }}>
              {t("catalogLabel", lang)} · {automCatalog.length}{automLoading ? ` · ${t("loading", lang)}` : ""}
            </div>
            {automCatalog.length === 0 && !automLoading ? (
              <div className="empty">
                <strong>Otomasyon bulunamadı</strong>
                <p>{t("loading", lang)}</p>
              </div>
            ) : (
              <div className="catalog-grid">
                {automCatalog.map((tmpl) => {
                  const job = jobByName.get(tmpl.name.toLowerCase());
                  const busy = automBusy[tmpl.name] ?? false;
                  return (
                    <article key={tmpl.name} className={`catalog-card autom-card${job ? " autom-installed" : ""}`}>
                      <div className="catalog-card-icon autom-icon">
                        <Icon name="lightning" size={16} />
                      </div>
                      <div className="catalog-card-body">
                        <h3>
                          {tmpl.name}
                          <span>v{tmpl.version}</span>
                          {job && (
                            <span className={`badge ${job.enabled ? "ok" : "muted"}`} style={{ marginLeft: 6 }}>
                              {job.enabled ? "aktif" : "durduruldu"}
                            </span>
                          )}
                        </h3>
                        <p>{tmpl.description}</p>
                        <div className="chip-row" style={{ margin: "6px 0 0" }}>
                          <span className="chip">her {humanSeconds(tmpl.everySeconds)}</span>
                          {tmpl.permissions.shell && <span className="chip chip-warn">shell</span>}
                          {tmpl.permissions.git && <span className="chip chip-warn">git</span>}
                          {tmpl.permissions.network && <span className="chip chip-warn">net</span>}
                          {tmpl.tags?.map((tag) => <span key={tag} className="chip">{tag}</span>)}
                        </div>
                      </div>
                      <div className="autom-actions">
                        {job ? (
                          <>
                            {/* toggle switch */}
                            <button
                              className={`autom-toggle${job.enabled ? " on" : ""}`}
                              title={job.enabled ? "Durdur" : "Başlat"}
                              disabled={busy}
                              onClick={() => handleToggle(job)}
                            >
                              <span className="autom-toggle-knob" />
                            </button>
                            {/* uninstall */}
                            <button
                              className="autom-remove"
                              title="Kaldır"
                              disabled={busy}
                              onClick={() => handleUninstall(tmpl.name)}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="autom-install"
                            disabled={busy}
                            onClick={() => handleInstall(tmpl.name)}
                          >
                            {busy ? "…" : "Kur"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* ── Installed (kurulanlar) ── */}
            {automJobs.length > 0 && (
              <>
                <div className="catalog-meta" style={{ marginTop: 20, marginBottom: 6 }}>
                  Kurulan otomasyonlar · {automJobs.length}
                </div>
                <div className="autom-installed-list">
                  {automJobs.map((job) => {
                    const busy = automBusy[job.name] ?? false;
                    return (
                      <div key={job.id} className={`autom-row${job.enabled ? " enabled" : ""}`}>
                        <div className="autom-row-icon">
                          <Icon name="lightning" size={14} />
                        </div>
                        <div className="autom-row-info">
                          <span className="autom-row-name">{job.name}</span>
                          {job.lastResult && (
                            <span className="autom-row-last">{job.lastResult}</span>
                          )}
                        </div>
                        <span className="autom-row-interval">her {humanSeconds(job.everySeconds)}</span>
                        <button
                          className={`autom-toggle${job.enabled ? " on" : ""}`}
                          title={job.enabled ? "Durdur" : "Başlat"}
                          disabled={busy}
                          onClick={() => handleToggle(job)}
                        >
                          <span className="autom-toggle-knob" />
                        </button>
                        <button
                          className="autom-remove"
                          title="Kaldır"
                          disabled={busy}
                          onClick={() => handleUninstall(job.name)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}