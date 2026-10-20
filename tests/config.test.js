import { describe, expect, it } from 'vitest';
import { CONFIG_KEY, TOKEN_KEY, clearConfig, createStore, defaultDevice, hasConfig, loadConfig, saveConfig } from '../client/config.js';
import { GitHubStore } from '../client/github.js';
import { memoryStorage } from './helpers.js';

describe('Einstellungen', () => {
  it('speichert, lädt und löscht die Ablage für alle Apps', () => {
    const s = memoryStorage();
    expect(loadConfig(s)).toBeNull();
    expect(hasConfig(s)).toBe(false);
    const config = { kind: 'github', repo: 'team/methoden', device: 'Laptop', connectedAt: 1 };
    saveConfig(config, 'tok', s);
    expect(loadConfig(s)).toEqual({ config, token: 'tok' });
    expect(hasConfig(s)).toBe(true);
    saveConfig({ ...config, device: 'Büro' }, undefined, s);
    expect(loadConfig(s)?.token).toBe('tok');
    clearConfig(s);
    expect([s.getItem(CONFIG_KEY), s.getItem(TOKEN_KEY)]).toEqual([null, null]);
  });

  it('ignoriert unvollständige oder beschädigte Einstellungen', () => {
    const s = memoryStorage();
    s.setItem(CONFIG_KEY, '{');
    s.setItem(TOKEN_KEY, 'tok');
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, JSON.stringify({ kind: 'supabase', repo: 'x' }));
    expect(loadConfig(s)).toBeNull();
    s.setItem(CONFIG_KEY, JSON.stringify({ kind: 'github', repo: 'team/methoden' }));
    s.removeItem(TOKEN_KEY);
    expect(loadConfig(s)).toBeNull();
    expect(loadConfig(null)).toBeNull();
    expect(hasConfig({ getItem: () => { throw new Error('gesperrt'); } })).toBe(false);
  });

  it('leitet den Gerätenamen aus dem Browser ab', () => {
    expect(defaultDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' })).toBe('Chrome · Windows');
    expect(defaultDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' })).toBe('Safari · iOS');
    expect(defaultDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' })).toBe('Firefox · Linux');
    expect(defaultDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0' })).toBe('Edge · macOS');
    expect(defaultDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile' })).toBe('Chrome · Android');
    expect(defaultDevice({})).toBe('Browser');
  });

  it('erzeugt die passende Ablage', () => {
    const store = createStore({ kind: 'github', repo: 'team/methoden', device: 'x', connectedAt: 0 }, 'tok', async () => new Response());
    expect(store).toBeInstanceOf(GitHubStore);
    expect(store.repo).toBe('team/methoden');
  });
});
