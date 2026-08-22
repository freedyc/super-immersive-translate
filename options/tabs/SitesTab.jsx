import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Card, SelectField } from '../components/Field.jsx';
import { ENGINES, ENGINE_NAMES } from '../lib/constants.js';

export function SitesTab({ settings, update }) {
  const [siteInput, setSiteInput] = useState('');
  const [engineHost, setEngineHost] = useState('');
  const [engineChoice, setEngineChoice] = useState('google');

  const rules = settings.siteRules || { mode: 'blacklist', sites: [] };
  const siteEngines = settings.siteEngines || {};

  const addSite = () => {
    const host = siteInput.trim().toLowerCase();
    if (!host || rules.sites.includes(host)) { setSiteInput(''); return; }
    update({ siteRules: { ...rules, sites: [...rules.sites, host] } });
    setSiteInput('');
  };

  const removeSite = (host) => {
    update({ siteRules: { ...rules, sites: rules.sites.filter((s) => s !== host) } });
  };

  const addSiteEngine = () => {
    const host = engineHost.trim().toLowerCase();
    if (!host) return;
    update({ siteEngines: { ...siteEngines, [host]: engineChoice } });
    setEngineHost('');
  };

  const removeSiteEngine = (host) => {
    const next = { ...siteEngines };
    delete next[host];
    update({ siteEngines: next });
  };

  return (
    <>
      <Card title="站点规则">
        <SelectField
          label="模式"
          hint={rules.mode === 'blacklist'
            ? '黑名单：下面列出的站点不会自动翻译，其它站点正常。'
            : '白名单：只有下面列出的站点会自动翻译，其它站点都不翻译。'}
          value={rules.mode}
          options={[['blacklist', '黑名单（列出的站点不翻译）'], ['whitelist', '白名单（只翻译列出的站点）']]}
          onChange={(v) => update({ siteRules: { ...rules, mode: v } })}
        />

        <div className="form-control">
          <label className="label pb-1">
            <span className="label-text text-xs text-base-content/60">添加站点</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="example.com"
              value={siteInput}
              onChange={(e) => setSiteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSite(); }}
            />
            <button className="btn btn-primary btn-sm gap-1" onClick={addSite}>
              <Plus className="w-4 h-4" />
              添加
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {rules.sites.map((site) => (
            <span key={site} className="badge badge-outline gap-1 py-3 px-2.5">
              {site}
              <button
                className="btn btn-ghost btn-xs h-4 min-h-0 px-0.5 text-base-content/40 hover:text-error"
                onClick={() => removeSite(site)}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {rules.sites.length === 0 && (
            <span className="text-sm text-base-content/40">还没有添加站点</span>
          )}
        </div>
      </Card>

      <Card title="站点专用引擎">
        <p className="text-xs text-base-content/40">
          为特定站点指定翻译引擎，优先级高于全局引擎设置。
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            className="input input-bordered input-sm flex-1"
            placeholder="example.com"
            value={engineHost}
            onChange={(e) => setEngineHost(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addSiteEngine(); }}
          />
          <select
            className="select select-bordered select-sm"
            value={engineChoice}
            onChange={(e) => setEngineChoice(e.target.value)}
          >
            {ENGINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn btn-primary btn-sm gap-1" onClick={addSiteEngine}>
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {Object.entries(siteEngines).map(([host, eng]) => (
            <div key={host} className="flex items-center justify-between px-3 py-2 bg-base-200 rounded-lg text-sm">
              <span className="font-medium text-base-content">{host}</span>
              <span className="text-xs text-primary font-semibold">{ENGINE_NAMES[eng] || eng}</span>
              <button
                className="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
                onClick={() => removeSiteEngine(host)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {Object.keys(siteEngines).length === 0 && (
            <span className="text-sm text-base-content/40">还没有配置站点专用引擎</span>
          )}
        </div>
      </Card>
    </>
  );
}
