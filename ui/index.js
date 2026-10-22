/*
 * Gemeinsame Oberfläche der Ablage (Preact, ohne JSX – Apps brauchen keinen eigenen Build-Schritt).
 * Eigenständig gestaltet: nur Klassen mit Präfix `mcs-` (styles.css) auf den gemeinsamen Design-Tokens
 * der Apps – so sieht die Ablage in jeder App gleich aus, unabhängig von deren Klassennamen.
 * Einstieg: `createSyncUI(...)` liefert Komponenten und Dialog-Aufrufe für eine App.
 */
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthError, ConflictError, OfflineError, SetupError } from '../client/store.js';
import { APP_NAMES, textsFor } from './texts.js';

/** @typedef {import('../client/controller.js').SyncController} SyncController */
/** @typedef {import('../client/controller.js').ControllerState} ControllerState */
/** @typedef {import('./texts.js').Nouns} Nouns */
/** @typedef {import('./texts.js').SyncTexts} SyncTexts */
/** @typedef {import('preact').ComponentChildren} Children */

// ---------- Symbole ----------

/** @type {Record<string, string>} */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  sync: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7',
  off: 'M4 4l16 16M9 6.4A6 6 0 0 1 17.6 10 4 4 0 0 1 19.8 17M15 18H7a4.5 4.5 0 0 1-1.6-8.7',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  up: 'M12 19V6M6 11l6-6 6 6',
  down: 'M12 5v13M6 13l6 6 6-6',
  ext: 'M14 5h5v5M19 5l-8 8M17 14v5H5V7h5',
  close: 'M6 6l12 12M18 6L6 18',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0zM8 8h.01',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  right: 'M9 6l6 6-6 6',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4.5H8M12 7.5V12l3 2',
  share: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4M18 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM18 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  save: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  db: 'M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6zM5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5',
};
const GITHUB = 'M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6 0-.6 0-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.9.6 1.8v2.7c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5z';

/** @param {string} name @param {number} [size] */
const Icon = (name, size = 16) => (name === 'github'
  ? h('svg', { class: 'mcs-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { width: `${size}px`, height: `${size}px`, fill: 'currentColor', stroke: 'none' } }, h('path', { d: GITHUB }))
  : h('svg', { class: 'mcs-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { width: `${size}px`, height: `${size}px` } }, h('path', { d: PATHS[name] })));

/** Symbol je Zustand. @type {Record<string, string>} */
const STATE_ICON = { ok: 'check', pending: 'sync', busy: 'sync', offline: 'off', auth: 'warn', error: 'warn', conflict: 'warn', local: 'cloud', newer: 'warn', idle: 'cloud' };
/** Farbe je Zustand. @type {Record<string, string>} */
const STATE_TONE = { ok: 'ok', pending: 'busy', busy: 'busy', offline: 'off', auth: 'bad', error: 'bad', conflict: 'bad', local: 'off', newer: 'bad', idle: 'off' };

// ---------- Hilfen ----------

/** @param {SyncController} controller @returns {ControllerState} */
function useController(controller) {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
}

/** @param {string} repo */
const repoUrl = repo => `https://github.com/${repo}`;

/** @param {unknown} e */
const messageOf = e => String(/** @type {any} */ (e)?.message ?? e);

/** Neues fine-grained Token auf GitHub, vorbelegt (Repo wählt man selbst). @param {SyncTexts} T */
const tokenUrl = T => `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: T.setup.tokenName, description: T.setup.tokenDescription, contents: 'write', gists: 'write', expires_in: '90',
})}`;

/** Link zum Ansehen eines geteilten Dokuments (in derselben App). @param {string} gist */
export const shareUrl = gist => `${globalThis.location?.href.split('#')[0] ?? ''}#g=${gist}`;

/** Kennung eines geteilten Dokuments aus der Adresse (`#g=…`), sonst `null`. @param {string} hash */
export const sharedFromHash = hash => /^#g=([0-9a-f]{8,64})$/i.exec(hash)?.[1] ?? null;

/**
 * @typedef {object} Preview Früherer bzw. geteilter Stand, den die App nur lesend zeigt
 * @property {'version' | 'shared'} [kind] `shared`: per Link geteilt (nichts davon ist im Browser gespeichert)
 * @property {string} [gist] Kennung des geteilten Links
 * @property {string} id
 * @property {string} sha
 * @property {number} date
 * @property {string} device
 * @property {string} [name]
 * @property {unknown} data
 */
/** @typedef {import('../client/engine.js').Version} Version */

/**
 * @param {object} opts
 * @param {SyncController} opts.controller
 * @param {string} opts.lang
 * @param {Nouns} opts.nouns Bezeichnung der Dokumente in der Sprache der App
 * @param {() => string | null} [opts.currentId] ID des gerade bearbeiteten Dokuments
 * @param {(id: string) => void} [opts.onOpenDoc] Dokument öffnen (nach „Öffnen“ bzw. „Beide behalten“)
 * @param {(message: string) => void} [opts.toast]
 * @param {(doc: { id: string, data: unknown }) => boolean} [opts.preselect] beim Einrichten zum Hochladen vorausgewählt?
 * @param {(preview: Preview | null) => void} [opts.onPreview] früheren Stand nur lesend zeigen (`null`: zurück zum aktuellen)
 */
export function createSyncUI({ controller, lang, nouns, currentId = () => null, onOpenDoc = () => {}, toast = () => {}, preselect = () => true, onPreview = () => {} }) {
  const T = textsFor(lang);
  const adapter = controller.adapter;
  const dateTime = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const timeOnly = new Intl.DateTimeFormat(lang, { timeStyle: 'short' });
  const dateOnly = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' });
  /** Zeitpunkt, heute nur mit Uhrzeit. @param {number} t */
  const when = t => (new Date(t).toDateString() === new Date().toDateString() ? `${T.today} ${timeOnly.format(t)}` : dateTime.format(t));

  // ---------- Dialog-Fenster ----------

  /** @type {HTMLDialogElement | null} */
  let host = null;
  /** Inhalt im gemeinsamen Dialog zeigen. @param {import('preact').VNode} vnode @param {string} [cls] */
  function show(vnode, cls = '') {
    if (!host) {
      host = document.createElement('dialog');
      host.id = 'syncDialog';
      host.addEventListener('close', () => { if (host) render(null, host); });
      document.body.append(host);
    }
    host.className = `mcs-dialog ${cls}`.trim();
    render(vnode, host);
    if (!host.open) host.showModal();
  }
  function closeDialog() { host?.close(); }

  /** @param {{ title: Children }} props */
  const Head = ({ title }) => h('div', { class: 'mcs-head' },
    h('h2', { id: 'syncDialogTitle' }, title),
    h('button', { type: 'button', class: 'mcs-icon-btn', 'aria-label': T.setup.close, title: T.setup.close, onClick: closeDialog }, Icon('close', 18)));

  /** @param {{ icon?: string, tone?: string, children?: Children }} props */
  const Note = ({ icon = 'cloud', tone = '', children }) => h('div', { class: `mcs-note ${tone}` }, Icon(icon, 18), h('div', null, children));

  // ---------- Einrichten ----------

  function SetupDialog() {
    const [step, setStep] = useState(1);
    const [repo, setRepo] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    /** @type {[import('../client/store.js').StoreCheck | null, (c: import('../client/store.js').StoreCheck | null) => void]} */
    const [check, setCheck] = useState(/** @type {import('../client/store.js').StoreCheck | null} */ (null));
    const docs = adapter.list();
    const [selected, setSelected] = useState(() => new Set(docs.filter(d => preselect(d)).map(d => d.id)));

    const steps = h('ol', { class: 'mcs-steps' }, T.setup.steps.map((s, i) => h('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '' }, h('b', null, i + 1 < step ? '✓' : String(i + 1)), s)));

    async function verify() {
      setBusy(true);
      setError('');
      try {
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) throw new SetupError('repo-format', 400);
        setCheck(await controller.check({ repo, token }));
        setStep(3);
      } catch (e) {
        setError(e instanceof AuthError ? T.setup.errors.auth
          : e instanceof OfflineError ? T.setup.errors.offline
            : e instanceof SetupError && e.message === 'repo-format' ? T.setup.errors.format
              : e instanceof SetupError && e.status === 404 ? T.setup.errors.notFound
                : T.setup.errors.other(String(/** @type {any} */ (e)?.message ?? e)));
      } finally {
        setBusy(false);
      }
    }

    async function finish() {
      setBusy(true);
      try {
        await controller.connect({ repo, token, expiresAt: check?.expiresAt ?? null }, [...selected]);
      } finally {
        setBusy(false);
      }
      closeDialog();
    }

    if (step === 1) {
      return h('div', { class: 'mcs-setup', 'data-step': '1' },
        h(Head, { title: T.setup.title }),
        h('p', { class: 'mcs-hint' }, T.setup.hint(nouns)),
        steps,
        h('ul', { class: 'mcs-list' },
          h('li', { class: 'mcs-doc mcs-choice is-current' },
            h('input', { type: 'radio', name: 'mcs-kind', checked: true, 'aria-label': T.setup.github }), Icon('github', 28),
            h('div', { class: 'mcs-doc-info' },
              h('span', { class: 'mcs-doc-title' }, T.setup.github, h('span', { class: 'mcs-badge' }, T.setup.githubBadge)),
              h('span', { class: 'mcs-doc-desc' }, T.setup.githubDesc(nouns)),
              h('span', { class: 'mcs-doc-meta' }, T.setup.githubMeta))),
          h('li', { class: 'mcs-doc mcs-choice is-off' },
            h('input', { type: 'radio', name: 'mcs-kind', disabled: true, 'aria-label': T.setup.supabase }), Icon('db', 28),
            h('div', { class: 'mcs-doc-info' },
              h('span', { class: 'mcs-doc-title' }, T.setup.supabase, h('span', { class: 'mcs-badge mcs-grey' }, T.setup.supabaseBadge)),
              h('span', { class: 'mcs-doc-desc' }, T.setup.supabaseDesc),
              h('span', { class: 'mcs-doc-meta' }, T.setup.supabaseMeta)))),
        h(Note, null, h('b', null, T.setup.allApps), ' ', T.setup.allAppsText),
        h('div', { class: 'mcs-foot' },
          h('span', { class: 'mcs-spacer' }),
          h('button', { type: 'button', class: 'mcs-btn', onClick: closeDialog }, T.setup.cancel),
          h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'next', onClick: () => setStep(2) }, T.setup.next)));
    }

    if (step === 2) {
      return h('form', { class: 'mcs-setup', 'data-step': '2', onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); verify(); } },
        h(Head, { title: T.setup.title }),
        steps,
        h('ol', { class: 'mcs-num' },
          h('li', null, h('h3', null, T.setup.repoTitle), T.setup.repoText, ' ',
            h('a', { class: 'mcs-link', href: 'https://github.com/new', target: '_blank', rel: 'noopener' }, T.setup.repoLink, Icon('ext', 14)),
            h('label', { class: 'mcs-field' }, T.setup.repoLabel,
              h('input', { name: 'repo', value: repo, autocomplete: 'off', spellcheck: false, required: true, placeholder: 'team/methoden', onInput: (/** @type {any} */ e) => setRepo(e.currentTarget.value) }),
              h('small', null, T.setup.repoHelp))),
          h('li', null, h('h3', null, T.setup.tokenTitle),
            h('p', { class: 'mcs-hint mcs-tight' }, T.setup.tokenText[0], h('b', null, T.setup.tokenText[1]), T.setup.tokenText[2]),
            h('div', { class: 'mcs-token' },
              h('a', { class: 'mcs-btn mcs-primary', href: tokenUrl(T), target: '_blank', rel: 'noopener', 'data-sync': 'token-link' }, Icon('ext', 14), T.setup.tokenLink),
              h('small', null, T.setup.tokenScopes), h('small', null, T.setup.tokenOwner)),
            h('label', { class: 'mcs-field' }, T.setup.tokenLabel,
              h('input', { name: 'token', type: 'password', value: token, autocomplete: 'off', required: true, onInput: (/** @type {any} */ e) => setToken(e.currentTarget.value) })))),
        h(Note, { icon: 'warn', tone: 'warn' }, T.setup.tokenNote),
        error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null,
        h('div', { class: 'mcs-foot' },
          h('button', { type: 'button', class: 'mcs-btn', onClick: () => setStep(1) }, T.setup.back),
          h('span', { class: 'mcs-spacer' }),
          h('button', { type: 'button', class: 'mcs-btn', onClick: closeDialog }, T.setup.cancel),
          h('button', { type: 'submit', class: 'mcs-btn mcs-primary', 'data-sync': 'connect', disabled: busy || !repo.trim() || !token.trim() }, busy ? T.setup.checking : T.setup.connect)));
    }

    const c = /** @type {import('../client/store.js').StoreCheck} */ (check);
    /** @param {string} id */
    const toggle = id => { const s = new Set(selected); if (s.has(id)) s.delete(id); else s.add(id); setSelected(s); };
    return h('div', { class: 'mcs-setup', 'data-step': '3' },
      h(Head, { title: T.setup.title }),
      steps,
      h('ul', { class: 'mcs-checks' },
        h('li', null, Icon('check'), T.setup.checkRepo(c.name), h('small', null, c.isPrivate ? T.setup.private : T.setup.public)),
        c.created ? h('li', null, Icon('check'), T.setup.checkWrite, h('small', null, T.setup.checkWriteHint))
          : h('li', null, Icon('check'), T.setup.checkExisting, h('small', null, T.setup.checkExistingHint)),
        c.expiresAt ? h('li', null, Icon('check'), T.setup.checkExpiry(dateOnly.format(new Date(c.expiresAt)))) : null,
        h('li', null, Icon('check'), T.setup.checkFolder(adapter.app))),
      docs.length ? h('div', { class: 'mcs-h' }, T.setup.uploadHeading(nouns)) : null,
      docs.length ? h('ul', { class: 'mcs-list mcs-upload' }, docs.map(d => h('li', { class: 'mcs-doc', key: d.id },
        h('label', { class: 'mcs-check' },
          h('input', { type: 'checkbox', checked: selected.has(d.id), onChange: () => toggle(d.id) }),
          h('span', { class: 'mcs-doc-info' },
            h('span', { class: 'mcs-doc-title' }, adapter.title(d.data)),
            h('span', { class: 'mcs-doc-meta' }, adapter.summary?.(d.data) ?? '')))))) : null,
      h(Note, null, T.setup.uploadNote(nouns)),
      h('div', { class: 'mcs-foot' },
        h('button', { type: 'button', class: 'mcs-btn', onClick: () => setStep(2) }, T.setup.back),
        h('span', { class: 'mcs-spacer' }),
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'finish', disabled: busy, onClick: finish }, T.setup.uploadButton(selected.size, nouns))));
  }

  // ---------- Ablage (eingerichtet) ----------

  function StorageDialog() {
    const { config, sync } = useController(controller);
    const [renewing, setRenewing] = useState(false);
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    if (!config) return h('div', null, h(Head, { title: T.storage.title }));
    const days = config.expiresAt ? Math.floor((Date.parse(config.expiresAt) - Date.now()) / 86_400_000) : null;
    const docs = sync?.docs ?? {};
    const all = Object.keys(docs).length;
    const synced = Object.values(docs).filter(s => s !== 'local').length;
    const counts = controller.countsByApp();
    const names = /** @type {Record<string, string>} */ (APP_NAMES[/** @type {'de' | 'en'} */ (lang)] ?? APP_NAMES.de);
    const others = Object.keys(names).filter(app => app !== adapter.app).map(app => `${names[app]} ${counts[app] ?? 0}`).join(' · ');
    const problem = sync?.error ? (sync.error in T.storage.problem
      ? T.storage.problem[/** @type {'auth' | 'offline' | 'newer-schema'} */ (sync.error)]
      : `${T.storage.problem.error} ${sync.error}`) : '';

    async function renew() {
      setError('');
      try {
        const result = await controller.check({ repo: /** @type {any} */ (config).repo, token });
        controller.renewToken(token, result.expiresAt ?? null);
        setRenewing(false);
        setToken('');
      } catch (e) {
        setError(e instanceof AuthError ? T.setup.errors.auth : e instanceof OfflineError ? T.setup.errors.offline : T.setup.errors.other(String(/** @type {any} */ (e)?.message ?? e)));
      }
    }

    return h('div', { class: 'mcs-storage' },
      h(Head, { title: T.storage.title }),
      problem ? h(Note, { icon: 'warn', tone: 'warn' }, problem) : null,
      h('dl', { class: 'mcs-kv' },
        h('dt', null, T.storage.kind), h('dd', null, Icon('github'), ' ', T.storage.repo, ' ', h('b', null, config.repo)),
        h('dd', null, h('a', { class: 'mcs-link', href: repoUrl(config.repo), target: '_blank', rel: 'noopener' }, T.storage.onGitHub, Icon('ext', 14))),
        h('dt', null, T.storage.token),
        h('dd', null, days == null ? T.storage.expiresUnknown : T.storage.expires(dateOnly.format(new Date(/** @type {string} */ (config.expiresAt))), days)),
        h('dd', null, h('button', { type: 'button', class: 'mcs-btn mcs-small', onClick: () => setRenewing(!renewing) }, T.storage.renew)),
        renewing ? h('dd', { class: 'mcs-wide' },
          h('a', { class: 'mcs-link', href: tokenUrl(T), target: '_blank', rel: 'noopener' }, T.storage.renewLink, Icon('ext', 14)),
          h('form', { class: 'mcs-inline', onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); renew(); } },
            h('input', { type: 'password', value: token, 'aria-label': T.setup.tokenLabel, autocomplete: 'off', onInput: (/** @type {any} */ e) => setToken(e.currentTarget.value) }),
            h('button', { type: 'submit', class: 'mcs-btn mcs-small mcs-primary', disabled: !token.trim() }, T.storage.renewSave)),
          error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null) : null,
        h('dt', null, T.storage.device),
        h('dd', { class: 'mcs-wide' }, h('input', {
          class: 'mcs-input', value: config.device, 'aria-label': T.storage.device,
          onChange: (/** @type {any} */ e) => controller.setDevice(e.currentTarget.value),
        }), h('small', null, ' ', T.storage.deviceHelp)),
        h('dt', null, T.storage.thisApp), h('dd', { class: 'mcs-wide' }, T.storage.counts(all, synced, sync?.remoteOnly.length ?? 0, nouns)),
        h('dt', null, T.storage.otherApps), h('dd', { class: 'mcs-wide' }, others),
        h('dt', null, T.storage.versions), h('dd', { class: 'mcs-wide' }, T.storage.versionsText)),
      h(Note, { icon: 'warn', tone: 'warn' }, h('b', null, T.storage.gitDelete), ' ', T.storage.gitDeleteText(nouns)),
      h('div', { class: 'mcs-foot' },
        h('button', {
          type: 'button', class: 'mcs-btn mcs-danger', 'data-sync': 'disconnect',
          onClick: () => { if (window.confirm(T.storage.confirmDisconnect)) { controller.disconnect(); closeDialog(); } },
        }, T.storage.disconnect),
        h('span', { class: 'mcs-spacer' }),
        h('button', { type: 'button', class: 'mcs-btn', onClick: () => controller.engine?.flush() }, T.storage.syncNow),
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', onClick: closeDialog }, T.storage.done)));
  }

  // ---------- Konflikt ----------

  /** @param {{ id: string }} props */
  function ConflictDialog({ id }) {
    const [info, setInfo] = useState(/** @type {Awaited<ReturnType<import('../client/engine.js').SyncEngine['conflictInfo']>> | null} */ (null));
    const [busy, setBusy] = useState(false);
    useEffect(() => { controller.engine?.conflictInfo(id).then(setInfo, () => setInfo(null)); }, [id]);
    if (!info) return h('div', null, h(Head, { title: T.conflict.loading }));
    const title = info.local?.title ?? info.remote?.title ?? id;
    const copyTitle = T.copyLabel(info.remote?.title ?? title, info.remote?.device ?? '');
    /** @param {'mine' | 'theirs' | 'both'} choice */
    async function choose(choice) {
      setBusy(true);
      try {
        const copy = await controller.engine?.resolve(id, choice);
        closeDialog();
        if (copy) onOpenDoc(copy);
      } finally {
        setBusy(false);
      }
    }
    /** @param {string} label @param {any} side */
    const Side = (label, side) => h('div', { class: 'mcs-side' },
      h('h3', null, label),
      side ? h('div', { class: 'mcs-doc-meta' }, [T.conflict.changed(when(side.savedAt)), side.device, side.summary].filter(Boolean).join(' · '))
        : h('div', { class: 'mcs-doc-meta' }, T.conflict.missing));
    return h('div', { class: 'mcs-conflict' },
      h(Head, { title: T.conflict.title(title) }),
      h('p', { class: 'mcs-hint' }, info.base ? T.conflict.base(when(info.base)) : T.conflict.baseUnknown),
      h('div', { class: 'mcs-sides' }, Side(T.conflict.here, info.local), Side(T.conflict.there, info.remote)),
      h('div', { class: 'mcs-opts' },
        info.remote ? h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'both', disabled: busy, onClick: () => choose('both') }, T.conflict.both), h('span', null, T.conflict.bothText(copyTitle, nouns))) : null,
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'mcs-btn', 'data-sync': 'mine', disabled: busy, onClick: () => choose('mine') }, T.conflict.mine), h('span', null, T.conflict.mineText)),
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'mcs-btn', 'data-sync': 'theirs', disabled: busy, onClick: () => choose('theirs') }, T.conflict.theirs), h('span', null, T.conflict.theirsText))),
      h(Note, null, T.conflict.note));
  }

  // ---------- Versionen ----------

  const dayMonth = new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit' });
  /** Überschrift eines Tages. @param {number} t */
  function dayLabel(t) {
    const d = new Date(t).toDateString();
    if (d === new Date().toDateString()) return T.versions.today;
    if (d === new Date(Date.now() - 86_400_000).toDateString()) return T.versions.yesterday(dayMonth.format(t));
    return dateOnly.format(t);
  }

  /** Früherer Stand, der gerade angesehen wird. @type {Preview | null} */
  let preview = null;
  /** @type {Set<() => void>} */
  const previewListeners = new Set();
  /** @param {Preview | null} p */
  function setPreview(p) {
    preview = p;
    onPreview(p);
    previewListeners.forEach(fn => fn());
  }
  /** Ansehen beenden (z. B. beim Öffnen eines anderen Dokuments). */
  function endPreview() { if (preview) setPreview(null); }

  /** @param {string} id @param {Version} v */
  async function view(id, v) {
    try {
      const { data } = await /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine).versionData(id, v.sha);
      closeDialog();
      setPreview({ id, sha: v.sha, date: v.date, device: v.device, name: v.name, data });
    } catch (e) {
      toast(T.versions.failed(messageOf(e)));
    }
  }

  /** @param {string} id @param {Version} v */
  async function copy(id, v) {
    try {
      const copyId = await /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine).copyVersion(id, v.sha, T.versions.copyLabel(dateTime.format(v.date)));
      endPreview();
      closeDialog();
      onOpenDoc(copyId);
    } catch (e) {
      toast(T.versions.failed(messageOf(e)));
    }
  }

  /** Kennzahlen eines Stands, erst geladen, wenn er zu sehen ist. @param {{ id: string, v: Version }} props */
  function VersionMeta({ id, v }) {
    const [info, setInfo] = useState(/** @type {import('../client/engine.js').VersionInfo | null} */ (null));
    useEffect(() => { controller.engine?.versionInfo(id, v.sha).then(setInfo, () => {}); }, [v.sha]);
    return h('span', { class: 'mcs-doc-meta' }, [v.device || info?.device, info?.summary].filter(Boolean).join(' · ') || '\u00a0');
  }

  /** @param {{ id: string, v: Version, withDate?: boolean }} props */
  function VersionRow({ id, v, withDate = false }) {
    return h('li', { class: `mcs-doc mcs-version${v.current ? ' is-current' : ''}${v.name ? ' is-named' : ''}`, 'data-version': v.sha },
      h('span', { class: 'mcs-version-time' }, withDate ? dateTime.format(v.date) : timeOnly.format(v.date)),
      h('div', { class: 'mcs-doc-info' },
        v.current || v.name ? h('span', { class: 'mcs-doc-title' },
          v.current ? h('span', { class: 'mcs-badge mcs-badge-first' }, T.versions.current) : null,
          v.name ? h('span', { class: 'mcs-version-name' }, Icon('tag', 14), v.name) : null) : null,
        v.note ? h('span', { class: 'mcs-doc-desc' }, v.note) : null,
        h(VersionMeta, { id, v })),
      v.current ? null : h('div', { class: 'mcs-doc-actions' },
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'view', onClick: () => view(id, v) }, Icon('eye'), T.versions.view),
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'restore', onClick: () => openRestore(id, v) }, Icon('undo'), T.versions.restore)));
  }

  /** @param {{ id: string }} props */
  function VersionsDialog({ id }) {
    const { config, sync } = useController(controller);
    const [items, setItems] = useState(/** @type {Version[] | null} */ (null));
    const [named, setNamed] = useState(/** @type {Version[]} */ ([]));
    const [page, setPage] = useState(1);
    const [more, setMore] = useState(false);
    const [error, setError] = useState('');
    const [onlyNamed, setOnlyNamed] = useState(false);
    const [open, setOpen] = useState(/** @type {Set<string>} */ (new Set()));
    const local = adapter.read(id);
    const title = local ? adapter.title(local.data) : id;
    const state = sync?.docs[id];

    /** @param {number} p */
    async function load(p) {
      setError('');
      try {
        const r = await /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine).versions(id, p);
        setItems(prev => (p === 1 ? r.items : [...(prev ?? []), ...r.items]));
        setNamed(r.named);
        setMore(r.more);
        setPage(p);
      } catch (e) {
        setError(T.versions.error(messageOf(e)));
        setItems(prev => prev ?? []);
      }
    }
    useEffect(() => { if (state !== 'local') load(1); }, [id]);

    const head = h(Head, { title: T.versions.title(title) });
    if (!config) return h('div', null, head);
    if (state === 'local') {
      return h('div', { class: 'mcs-versions' }, head, h(Note, null, T.versions.localOnly(nouns)),
        h('div', { class: 'mcs-foot' }, h('button', { type: 'button', class: 'mcs-btn mcs-primary', onClick: closeDialog }, T.versions.close)));
    }

    /** Stände nach Tagen; der neueste Tag ist aufgeklappt. @type {{ key: string, label: string, list: Version[] }[]} */
    const days = [];
    for (const v of items ?? []) {
      const key = new Date(v.date).toDateString();
      const last = days[days.length - 1];
      if (last?.key === key) last.list.push(v); else days.push({ key, label: dayLabel(v.date), list: [v] });
    }
    const isOpen = (/** @type {string} */ key, /** @type {number} */ i) => i === 0 || key === new Date().toDateString() || open.has(key);
    const historyUrl = `${repoUrl(config.repo)}/commits/${config.branch || 'HEAD'}/${adapter.app}/${id}.json`;

    return h('div', { class: 'mcs-versions' },
      head,
      h('p', { class: 'mcs-hint' }, T.versions.hint),
      h('div', { class: 'mcs-toolbar' },
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'save-version', disabled: state === 'conflict', onClick: () => openSaveVersion(id) }, Icon('tag'), T.versions.save),
        h('div', { class: 'mcs-seg', role: 'group' },
          h('button', { type: 'button', 'aria-pressed': onlyNamed ? 'false' : 'true', onClick: () => setOnlyNamed(false) }, T.versions.all),
          h('button', { type: 'button', 'aria-pressed': onlyNamed ? 'true' : 'false', 'data-sync': 'only-named', onClick: () => setOnlyNamed(true) }, T.versions.named)),
        h('span', { class: 'mcs-spacer' }),
        h('a', { class: 'mcs-link', href: historyUrl, target: '_blank', rel: 'noopener' }, T.versions.onGitHub, Icon('ext', 14))),
      state === 'conflict' ? h(Note, { icon: 'warn', tone: 'warn' }, T.versions.conflict) : null,
      error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null,
      items == null ? h('p', { class: 'mcs-muted' }, T.versions.loading)
        : onlyNamed ? (named.length
          ? h('ul', { class: 'mcs-list' }, named.map(v => h(VersionRow, { id, v, withDate: true, key: v.sha })))
          : h('p', { class: 'mcs-muted' }, T.versions.noNamed))
          : !items.length ? h('p', { class: 'mcs-muted' }, T.versions.empty(nouns))
            : days.map((d, i) => h('section', { class: 'mcs-day', key: d.key },
              h('div', { class: 'mcs-h' }, d.label),
              isOpen(d.key, i)
                ? h('ul', { class: 'mcs-list' }, d.list.map(v => h(VersionRow, { id, v, key: v.sha })))
                : h('button', { type: 'button', class: 'mcs-collapsed', 'data-sync': 'expand', onClick: () => setOpen(new Set([...open, d.key])) },
                  Icon('right', 14), T.versions.collapsed(d.list.length)))),
      !onlyNamed && more ? h('button', { type: 'button', class: 'mcs-btn mcs-small mcs-more', onClick: () => load(page + 1) }, T.versions.more) : null);
  }

  /** @param {{ id: string }} props */
  function SaveVersionDialog({ id }) {
    const [name, setName] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function save() {
      setBusy(true);
      setError('');
      try {
        const tag = await /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine).saveVersion(id, name, note);
        toast(T.versions.saved(tag.name));
        openVersions(id);
      } catch (e) {
        setError(e instanceof ConflictError ? T.versions.conflict
          : e instanceof SetupError && e.message === 'local-only' ? T.versions.localOnly(nouns) : T.versions.failed(messageOf(e)));
      } finally {
        setBusy(false);
      }
    }
    return h('form', { class: 'mcs-save-version', onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); save(); } },
      h(Head, { title: T.versions.saveTitle }),
      h('p', { class: 'mcs-hint' }, T.versions.saveHint),
      h('label', { class: 'mcs-field' }, T.versions.name,
        h('input', { name: 'name', value: name, required: true, maxLength: 80, placeholder: T.versions.namePlaceholder, autofocus: true, onInput: (/** @type {any} */ e) => setName(e.currentTarget.value) })),
      h('label', { class: 'mcs-field' }, T.versions.note,
        h('textarea', { name: 'note', value: note, rows: 3, onInput: (/** @type {any} */ e) => setNote(e.currentTarget.value) })),
      error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null,
      h('div', { class: 'mcs-foot' },
        h('button', { type: 'button', class: 'mcs-btn', onClick: () => openVersions(id) }, T.versions.cancel),
        h('button', { type: 'submit', class: 'mcs-btn mcs-primary', 'data-sync': 'save-version-confirm', disabled: busy || !name.trim() }, busy ? T.versions.saving : T.versions.saveButton)));
  }

  /** @param {{ id: string, v: Version }} props */
  function RestoreDialog({ id, v }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const local = adapter.read(id);
    async function restore() {
      setBusy(true);
      setError('');
      try {
        // Vorschau zuerst beenden: Die App nimmt den Stand sonst nicht an
        endPreview();
        if (await /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine).restore(id, v.sha)) {
          closeDialog();
          toast(T.versions.restored(dateTime.format(v.date)));
        } else {
          setError(T.versions.refused);
        }
      } catch (e) {
        setError(e instanceof ConflictError ? T.versions.conflict : T.versions.failed(messageOf(e)));
      } finally {
        setBusy(false);
      }
    }
    return h('div', { class: 'mcs-restore' },
      h(Head, { title: T.versions.restoreTitle }),
      h('div', { class: 'mcs-sides' },
        h('div', { class: 'mcs-side is-target' }, h('h3', null, T.versions.restoreThis),
          h('div', { class: 'mcs-doc-meta' }, [dateTime.format(v.date), v.name ? `„${v.name}“` : ''].filter(Boolean).join(' · ')),
          h(VersionMeta, { id, v })),
        h('div', { class: 'mcs-side' }, h('h3', null, T.versions.restoreNow),
          local ? h('div', { class: 'mcs-doc-meta' }, [when(local.savedAt), adapter.summary?.(local.data)].filter(Boolean).join(' · ')) : null)),
      error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null,
      h('div', { class: 'mcs-opts' },
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'restore-confirm', disabled: busy, onClick: restore }, Icon('undo'), T.versions.restoreButton), h('span', null, T.versions.restoreHint)),
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'mcs-btn', 'data-sync': 'copy', disabled: busy, onClick: () => copy(id, v) }, Icon('copy'), T.versions.copy), h('span', null, T.versions.copyHint(nouns)))),
      h('div', { class: 'mcs-foot' }, h('button', { type: 'button', class: 'mcs-btn', onClick: () => (preview ? closeDialog() : openVersions(id)) }, T.versions.cancel)));
  }

  function NoStorageDialog() {
    return h('div', { class: 'mcs-versions' },
      h(Head, { title: T.versions.noStorageTitle }),
      h('p', { class: 'mcs-hint' }, T.versions.noStorage(nouns)),
      h(Note, null, T.versions.noStorageNote),
      h('div', { class: 'mcs-foot' },
        h('button', { type: 'button', class: 'mcs-btn', onClick: closeDialog }, T.versions.close),
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'setup', onClick: openStorage }, T.versions.setUp)));
  }

  /** Leiste über dem früheren Stand: Wiederherstellen, Kopie, zurück. */
  function PreviewBar() {
    const [, setTick] = useState(0);
    useEffect(() => {
      const fn = () => setTick(t => t + 1);
      previewListeners.add(fn);
      fn(); // inzwischen gesetzte Ansicht (z. B. sofort geöffneter Link) nachholen
      return () => { previewListeners.delete(fn); };
    }, []);
    const p = preview;
    if (!p) return null;
    if (p.kind === 'shared') return h(SharedBar, { p });
    const v = { sha: p.sha, date: p.date, device: p.device, name: p.name };
    return h('div', { class: 'mcs-preview', role: 'status', id: 'syncPreview' },
      Icon('eye', 18),
      h('div', { class: 'mcs-preview-text' },
        h('b', null, T.versions.preview), ' ', [dateTime.format(p.date), p.device, p.name ? `„${p.name}“` : ''].filter(Boolean).join(' · '),
        ' – ', T.versions.previewLocked),
      h('div', { class: 'mcs-row' },
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'preview-restore', onClick: () => openRestore(p.id, v) }, Icon('undo'), T.versions.restore),
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'preview-copy', onClick: () => copy(p.id, v) }, Icon('copy'), T.versions.copy),
        h('button', { type: 'button', class: 'mcs-btn mcs-small mcs-primary', 'data-sync': 'preview-back', onClick: endPreview }, T.versions.back)));
  }

  // ---------- Teilen zum Ansehen ----------

  /** Fehlermeldung beim Öffnen eines geteilten Links. @param {unknown} e */
  function sharedError(e) {
    const E = T.share.errors;
    if (e instanceof OfflineError) return E.offline;
    if (e instanceof SetupError) {
      if (e.message === 'share-missing') return E.missing;
      if (e.message === 'share-other-app') return E.otherApp;
      if (e.message === 'newer-schema') return E.newer;
    }
    return E.invalid;
  }

  /** Leiste über einem geteilten Dokument: Aktualisieren, Als Kopie speichern, Schließen. @param {{ p: Preview }} props */
  function SharedBar({ p }) {
    const [busy, setBusy] = useState(false);
    async function refresh() {
      setBusy(true);
      try {
        const { data, savedAt, device } = await controller.readShared(/** @type {string} */ (p.gist));
        setPreview({ ...p, date: savedAt, device, data });
        toast(T.share.refreshed);
      } catch (e) {
        toast(sharedError(e));
      } finally {
        setBusy(false);
      }
    }
    function saveCopy() {
      const copy = adapter.duplicate(p.data, T.share.copyLabel);
      adapter.write(copy.id, copy.data, Date.now());
      controller.changed(copy.id);
      endPreview();
      onOpenDoc(copy.id);
      toast(T.share.copySaved(nouns));
    }
    return h('div', { class: 'mcs-preview', role: 'status', id: 'syncPreview', 'data-kind': 'shared' },
      Icon('eye', 18),
      h('div', { class: 'mcs-preview-text' },
        h('b', null, T.share.viewTitle(nouns)), ' ', T.share.viewMeta(p.device, dateTime.format(p.date)), ' – ', T.share.viewLocked),
      h('div', { class: 'mcs-row' },
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'shared-refresh', disabled: busy, onClick: refresh }, Icon('sync'), T.share.refresh),
        h('button', { type: 'button', class: 'mcs-btn mcs-small mcs-primary', 'data-sync': 'shared-copy', onClick: saveCopy }, Icon('save'), T.share.saveCopy),
        h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'shared-close', onClick: endPreview }, T.share.close)));
  }

  /** @param {{ id: string }} props */
  function ShareDialog({ id }) {
    const { sync } = useController(controller);
    const engine = /** @type {import('../client/engine.js').SyncEngine} */ (controller.engine);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {Children} */ (null));
    const local = adapter.read(id);
    const title = local ? adapter.title(local.data) : id;
    const info = engine.shareInfo(id);
    void sync; // neu zeichnen, wenn sich die Merkliste ändert

    async function create() {
      setBusy(true);
      setError(null);
      try {
        await engine.share(id);
      } catch (e) {
        setError(e instanceof AuthError && e.status === 403
          ? h(Note, { icon: 'warn', tone: 'warn' }, h('b', null, T.share.permission), ' ', T.share.permissionText, ' ',
            h('a', { class: 'mcs-link', href: tokenUrl(T), target: '_blank', rel: 'noopener', 'data-sync': 'token-link' }, T.setup.tokenLink, Icon('ext', 14)))
          : h('p', { class: 'mcs-error', role: 'alert' }, e instanceof ConflictError ? T.versions.conflict
            : e instanceof SetupError && e.message === 'local-only' ? T.versions.localOnly(nouns) : T.versions.failed(messageOf(e))));
      } finally {
        setBusy(false);
      }
    }
    async function stop() {
      if (!window.confirm(T.share.confirmStop)) return;
      setBusy(true);
      try {
        await engine.unshare(id);
        toast(T.share.stopped);
      } catch (e) {
        setError(h('p', { class: 'mcs-error', role: 'alert' }, T.versions.failed(messageOf(e))));
      } finally {
        setBusy(false);
      }
    }
    async function copyLink() {
      const url = shareUrl(/** @type {import('../client/store.js').ShareInfo} */ (info).gist);
      try { await navigator.clipboard.writeText(url); toast(T.share.copied); } catch (e) { window.prompt(T.share.link, url); }
    }

    if (!info) {
      return h('div', { class: 'mcs-share' },
        h(Head, { title: T.share.title(title) }),
        h('p', { class: 'mcs-hint' }, T.share.intro(nouns)),
        h(Note, { icon: 'warn', tone: 'warn' }, h('b', null, T.share.warn), ' ', T.share.warnText),
        h('dl', { class: 'mcs-kv' },
          h('dt', null, T.share.storedAs), h('dd', { class: 'mcs-wide' }, T.share.storedAsText),
          h('dt', null, T.share.editing), h('dd', { class: 'mcs-wide' }, T.share.editingText)),
        error,
        h('div', { class: 'mcs-foot' },
          h('span', { class: 'mcs-spacer' }),
          h('button', { type: 'button', class: 'mcs-btn', onClick: closeDialog }, T.share.cancel),
          h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'share-create', disabled: busy, onClick: create }, Icon('share'), busy ? T.share.creating : T.share.create)));
    }
    return h('div', { class: 'mcs-share' },
      h(Head, { title: T.share.title(title) }),
      h('p', { class: 'mcs-hint' }, T.share.shared(nouns)),
      h('label', { class: 'mcs-field' }, T.share.link,
        h('div', { class: 'mcs-inline' },
          h('input', { class: 'mcs-input', readOnly: true, value: shareUrl(info.gist), name: 'share-link', onFocus: (/** @type {any} */ e) => e.currentTarget.select() }),
          h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'share-copy', onClick: copyLink }, Icon('copy'), T.share.copy))),
      h('dl', { class: 'mcs-kv' },
        h('dt', null, T.share.since), h('dd', { class: 'mcs-wide' }, when(info.since)),
        h('dt', null, T.share.state), h('dd', { class: 'mcs-wide' }, T.share.stateText),
        h('dt', null, T.share.onGitHub), h('dd', { class: 'mcs-wide' }, h('a', { class: 'mcs-link', href: `https://gist.github.com/${info.gist}`, target: '_blank', rel: 'noopener' }, T.share.gist, Icon('ext', 14)))),
      error,
      h('div', { class: 'mcs-foot' },
        h('button', { type: 'button', class: 'mcs-btn mcs-danger', 'data-sync': 'share-stop', disabled: busy, onClick: stop }, Icon('close'), T.share.stop),
        h('span', { class: 'mcs-spacer' }),
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', onClick: closeDialog }, T.share.done)));
  }

  function NoShareStorageDialog() {
    return h('div', { class: 'mcs-share' },
      h(Head, { title: T.share.menu }),
      h('p', { class: 'mcs-hint' }, T.share.noStorage(nouns)),
      h('div', { class: 'mcs-foot' },
        h('button', { type: 'button', class: 'mcs-btn', onClick: closeDialog }, T.versions.close),
        h('button', { type: 'button', class: 'mcs-btn mcs-primary', 'data-sync': 'setup', onClick: openStorage }, T.versions.setUp)));
  }

  // ---------- Statusanzeige ----------

  function StatusChip() {
    const { config, sync } = useController(controller);
    const [open, setOpen] = useState(false);
    const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => {
      if (!open) return undefined;
      /** @param {Event} e */
      const away = e => { if (e.type === 'keydown' ? /** @type {KeyboardEvent} */ (e).key === 'Escape' : !ref.current?.contains(/** @type {Node} */ (e.target))) setOpen(false); };
      document.addEventListener('pointerdown', away);
      document.addEventListener('keydown', away);
      return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', away); };
    }, [open]);
    if (!config) return null;
    const status = sync?.status ?? 'idle';
    const cur = currentId();
    const docState = cur ? sync?.docs[cur] : undefined;
    const pendingOthers = Object.entries(sync?.docs ?? {}).filter(([id, s]) => id !== cur && (s === 'pending' || s === 'busy')).length;
    function click() {
      if (status === 'conflict' && sync) {
        openConflict(cur && sync.docs[cur] === 'conflict' ? cur : sync.conflicts[0]);
        return;
      }
      setOpen(!open);
    }
    return h('div', { class: 'mcs-status', ref },
      h('button', {
        type: 'button', class: `mcs-chip ${STATE_TONE[status]}`, id: 'syncStatus', 'data-status': status,
        'aria-haspopup': status === 'conflict' ? 'dialog' : 'true', 'aria-expanded': open ? 'true' : 'false',
        title: T.statusHint[status], onClick: click,
      }, Icon(STATE_ICON[status]), h('span', { class: 'mcs-chip-label' }, T.status[status])),
      open ? h('div', { class: 'mcs-pop', role: 'dialog', 'aria-label': T.pop.heading },
        h('h3', null, T.pop.heading),
        h('dl', null,
          h('dt', null, T.pop.repo), h('dd', null, config.repo),
          docState ? [h('dt', null, T.pop.thisDoc(nouns)), h('dd', null, T.doc[docState])] : null,
          h('dt', null, T.pop.versions), h('dd', null, T.pop.versionsText),
          h('dt', null, T.pop.others(nouns)), h('dd', null, pendingOthers ? T.pop.othersPending(pendingOthers) : T.pop.othersAll)),
        sync?.lastSyncAt ? h('p', { class: 'mcs-muted' }, T.pop.lastSync(when(sync.lastSyncAt))) : null,
        status !== 'ok' && status !== 'idle' ? h('p', { class: 'mcs-muted' }, T.statusHint[status]) : null,
        h('div', { class: 'mcs-row' },
          h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'flush', onClick: () => { controller.engine?.flush(); } }, Icon('up'), T.pop.pushNow),
          cur ? h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'versions', onClick: () => { setOpen(false); openVersions(cur); } }, Icon('history'), T.versions.menu) : null,
          h('button', { type: 'button', class: 'mcs-btn mcs-small', onClick: () => { setOpen(false); openStorage(); } }, T.pop.storage))) : null);
  }

  // ---------- Liste der Dokumente der App ----------

  /** Zustand eines Dokuments in der Liste der App („Meine Matrizen“). @param {{ id: string }} props */
  function DocState({ id }) {
    const { config, sync } = useController(controller);
    if (!config || !sync) return null;
    const s = sync.docs[id] ?? 'pending';
    return h('span', { class: 'mcs-docstate' },
      sync.shared?.includes(id) ? h('button', { type: 'button', class: 'mcs-badge mcs-shared', 'data-sync': 'shared-badge', title: T.share.menu, onClick: () => openShare(id) }, T.share.badge) : null,
      h('span', { class: `mcs-state ${STATE_TONE[s]}`, 'data-doc-state': s }, Icon(STATE_ICON[s], 15), T.doc[s]),
      s === 'local' ? h('button', { type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'upload', onClick: () => { controller.engine?.upload([id]); } }, Icon('up'), T.upload) : null,
      s === 'conflict' ? h('button', { type: 'button', class: 'mcs-btn mcs-small', onClick: () => openConflict(id) }, T.solve) : null);
  }

  /** Abschnitt „Nur in der Ablage“ unter der Liste der App. */
  function RemoteOnly() {
    const { config, sync } = useController(controller);
    if (!config || !sync?.remoteOnly.length) return null;
    return h('div', { class: 'mcs-remote' },
      h('div', { class: 'mcs-h' }, T.remoteOnly),
      h('ul', { class: 'mcs-list' }, sync.remoteOnly.map(d => h('li', { class: 'mcs-doc', key: d.id },
        h('div', { class: 'mcs-doc-info' }, h('span', { class: 'mcs-doc-title' }, d.title), h('span', { class: 'mcs-doc-meta' }, T.remoteMeta(when(d.savedAt), d.device, d.summary))),
        h('div', { class: 'mcs-doc-actions' }, h('button', {
          type: 'button', class: 'mcs-btn mcs-small', 'data-sync': 'download',
          onClick: async () => { if (await controller.engine?.download(d.id)) onOpenDoc(d.id); },
        }, Icon('down'), T.open))))));
  }

  // ---------- Aufrufe ----------

  /** „Ablage …“: einrichten bzw. Übersicht. */
  function openStorage() {
    if (controller.state.config) show(h(StorageDialog, {}), 'mcs-storage-dialog');
    else show(h(SetupDialog, {}), 'mcs-setup-dialog');
  }

  /** @param {string} id */
  function openConflict(id) {
    show(h(ConflictDialog, { id, key: id }), 'mcs-conflict-dialog');
  }

  /** „Versionen …“ eines Dokuments; ohne Ablage ein Hinweis zum Einrichten. @param {string | null} id */
  function openVersions(id) {
    if (!controller.state.config || !controller.engine) show(h(NoStorageDialog, {}), 'mcs-versions-dialog');
    else if (id) show(h(VersionsDialog, { id, key: `v-${id}` }), 'mcs-versions-dialog');
  }

  /** @param {string} id */
  function openSaveVersion(id) {
    show(h(SaveVersionDialog, { id, key: `s-${id}` }), 'mcs-save-dialog');
  }

  /** „Teilen …“ eines Dokuments; ohne Ablage ein Hinweis zum Einrichten. @param {string | null} id */
  function openShare(id) {
    if (!controller.state.config || !controller.engine) show(h(NoShareStorageDialog, {}), 'mcs-share-dialog');
    else if (id) show(h(ShareDialog, { id, key: `share-${id}` }), 'mcs-share-dialog');
  }

  /**
   * Geteiltes Dokument nur lesend zeigen (Link `#g=…`). Es wird **nichts** gespeichert – weder im Browser noch in
   * einer eingerichteten Ablage; erst „Als Kopie speichern“ legt bewusst ein Dokument an.
   * @param {string} gist @returns {Promise<boolean>}
   */
  async function openShared(gist) {
    try {
      const { data, savedAt, device } = await controller.readShared(gist);
      setPreview({ kind: 'shared', gist, id: gist, sha: '', date: savedAt, device, data });
      return true;
    } catch (e) {
      toast(sharedError(e));
      return false;
    }
  }

  /** @param {string} id @param {Version} v */
  function openRestore(id, v) {
    show(h(RestoreDialog, { id, v, key: `r-${v.sha}` }), 'mcs-restore-dialog');
  }

  return {
    texts: T, StatusChip, DocState, RemoteOnly, PreviewBar, openStorage, openConflict, openVersions, openShare, openShared, endPreview, closeDialog,
    /** Wird gerade ein früherer Stand angesehen? */
    previewing: () => preview,
    /** Hinweis im Menü: Zustand der Ablage. */
    menuHint: () => (controller.state.config ? T.status[controller.state.sync?.status ?? 'idle'] : T.menu.notSet),
    /** Commit-Nachrichten in der Sprache der App (für die Engine). */
    messages: { save: T.commit.save, remove: T.commit.remove, share: T.commit.share },
    toast,
  };
}

export { textsFor, APP_NAMES } from './texts.js';
