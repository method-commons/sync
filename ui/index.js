/*
 * Gemeinsame Oberfläche der Ablage (Preact, ohne JSX – Apps brauchen keinen eigenen Build-Schritt).
 * Nutzt die Klassen der Apps (`dialog`, `btn`, `doc` …) und ergänzt eigene mit Präfix `mcs-`
 * (styles.css). Einstieg: `createSyncUI(...)` liefert Komponenten und Dialog-Aufrufe für eine App.
 */
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthError, OfflineError, SetupError } from '../client/store.js';
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

/**
 * @param {object} opts
 * @param {SyncController} opts.controller
 * @param {string} opts.lang
 * @param {Nouns} opts.nouns Bezeichnung der Dokumente in der Sprache der App
 * @param {() => string | null} [opts.currentId] ID des gerade bearbeiteten Dokuments
 * @param {(id: string) => void} [opts.onOpenDoc] Dokument öffnen (nach „Öffnen“ bzw. „Beide behalten“)
 * @param {(message: string) => void} [opts.toast]
 * @param {(doc: { id: string, data: unknown }) => boolean} [opts.preselect] beim Einrichten zum Hochladen vorausgewählt?
 */
export function createSyncUI({ controller, lang, nouns, currentId = () => null, onOpenDoc = () => {}, toast = () => {}, preselect = () => true }) {
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
    host.className = `dialog mcs-dialog ${cls}`.trim();
    render(vnode, host);
    if (!host.open) host.showModal();
  }
  function closeDialog() { host?.close(); }

  /** @param {{ title: Children }} props */
  const Head = ({ title }) => h('div', { class: 'dialog-head' },
    h('h2', { id: 'syncDialogTitle' }, title),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': T.setup.close, title: T.setup.close, onClick: closeDialog }, Icon('close', 18)));

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
        h('p', { class: 'dialog-hint' }, T.setup.hint(nouns)),
        steps,
        h('ul', { class: 'doc-list' },
          h('li', { class: 'doc mcs-choice is-current' },
            h('input', { type: 'radio', name: 'mcs-kind', checked: true, 'aria-label': T.setup.github }), Icon('github', 28),
            h('div', { class: 'doc-info' },
              h('span', { class: 'doc-title' }, T.setup.github, h('span', { class: 'badge' }, T.setup.githubBadge)),
              h('span', { class: 'doc-desc' }, T.setup.githubDesc(nouns)),
              h('span', { class: 'doc-meta' }, T.setup.githubMeta))),
          h('li', { class: 'doc mcs-choice is-off' },
            h('input', { type: 'radio', name: 'mcs-kind', disabled: true, 'aria-label': T.setup.supabase }), Icon('db', 28),
            h('div', { class: 'doc-info' },
              h('span', { class: 'doc-title' }, T.setup.supabase, h('span', { class: 'badge mcs-grey' }, T.setup.supabaseBadge)),
              h('span', { class: 'doc-desc' }, T.setup.supabaseDesc),
              h('span', { class: 'doc-meta' }, T.setup.supabaseMeta)))),
        h(Note, null, h('b', null, T.setup.allApps), ' ', T.setup.allAppsText),
        h('div', { class: 'dialog-foot' },
          h('span', { class: 'mcs-spacer' }),
          h('button', { type: 'button', class: 'btn', onClick: closeDialog }, T.setup.cancel),
          h('button', { type: 'button', class: 'btn btn-primary', 'data-sync': 'next', onClick: () => setStep(2) }, T.setup.next)));
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
          h('li', null, h('h3', null, T.setup.tokenTitle), T.setup.tokenText,
            h('ul', null, T.setup.tokenRules.map(([a, b, c]) => h('li', null, a, h('b', null, b), c))),
            h('a', { class: 'mcs-link', href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, T.setup.tokenLink, Icon('ext', 14)),
            h('label', { class: 'mcs-field' }, T.setup.tokenLabel,
              h('input', { name: 'token', type: 'password', value: token, autocomplete: 'off', required: true, onInput: (/** @type {any} */ e) => setToken(e.currentTarget.value) })))),
        h(Note, { icon: 'warn', tone: 'warn' }, T.setup.tokenNote),
        error ? h('p', { class: 'mcs-error', role: 'alert' }, error) : null,
        h('div', { class: 'dialog-foot' },
          h('button', { type: 'button', class: 'btn', onClick: () => setStep(1) }, T.setup.back),
          h('span', { class: 'mcs-spacer' }),
          h('button', { type: 'button', class: 'btn', onClick: closeDialog }, T.setup.cancel),
          h('button', { type: 'submit', class: 'btn btn-primary', 'data-sync': 'connect', disabled: busy || !repo.trim() || !token.trim() }, busy ? T.setup.checking : T.setup.connect)));
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
      docs.length ? h('ul', { class: 'doc-list mcs-upload' }, docs.map(d => h('li', { class: 'doc', key: d.id },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: selected.has(d.id), onChange: () => toggle(d.id) }),
          h('span', { class: 'doc-info' },
            h('span', { class: 'doc-title' }, adapter.title(d.data)),
            h('span', { class: 'doc-meta' }, adapter.summary?.(d.data) ?? '')))))) : null,
      h(Note, null, T.setup.uploadNote(nouns)),
      h('div', { class: 'dialog-foot' },
        h('button', { type: 'button', class: 'btn', onClick: () => setStep(2) }, T.setup.back),
        h('span', { class: 'mcs-spacer' }),
        h('button', { type: 'button', class: 'btn btn-primary', 'data-sync': 'finish', disabled: busy, onClick: finish }, T.setup.uploadButton(selected.size, nouns))));
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
        h('dd', null, h('button', { type: 'button', class: 'btn btn-small', onClick: () => setRenewing(!renewing) }, T.storage.renew)),
        renewing ? h('dd', { class: 'mcs-wide' },
          h('form', { class: 'mcs-inline', onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); renew(); } },
            h('input', { type: 'password', value: token, 'aria-label': T.setup.tokenLabel, autocomplete: 'off', onInput: (/** @type {any} */ e) => setToken(e.currentTarget.value) }),
            h('button', { type: 'submit', class: 'btn btn-small btn-primary', disabled: !token.trim() }, T.storage.renewSave)),
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
      h('div', { class: 'dialog-foot' },
        h('button', {
          type: 'button', class: 'btn mcs-danger', 'data-sync': 'disconnect',
          onClick: () => { if (window.confirm(T.storage.confirmDisconnect)) { controller.disconnect(); closeDialog(); } },
        }, T.storage.disconnect),
        h('span', { class: 'mcs-spacer' }),
        h('button', { type: 'button', class: 'btn', onClick: () => controller.engine?.flush() }, T.storage.syncNow),
        h('button', { type: 'button', class: 'btn btn-primary', onClick: closeDialog }, T.storage.done)));
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
      side ? h('div', { class: 'doc-meta' }, [T.conflict.changed(when(side.savedAt)), side.device, side.summary].filter(Boolean).join(' · '))
        : h('div', { class: 'doc-meta' }, T.conflict.missing));
    return h('div', { class: 'mcs-conflict' },
      h(Head, { title: T.conflict.title(title) }),
      h('p', { class: 'dialog-hint' }, info.base ? T.conflict.base(when(info.base)) : T.conflict.baseUnknown),
      h('div', { class: 'mcs-sides' }, Side(T.conflict.here, info.local), Side(T.conflict.there, info.remote)),
      h('div', { class: 'mcs-opts' },
        info.remote ? h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'btn btn-primary', 'data-sync': 'both', disabled: busy, onClick: () => choose('both') }, T.conflict.both), h('span', null, T.conflict.bothText(copyTitle, nouns))) : null,
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'btn', 'data-sync': 'mine', disabled: busy, onClick: () => choose('mine') }, T.conflict.mine), h('span', null, T.conflict.mineText)),
        h('div', { class: 'mcs-opt' }, h('button', { type: 'button', class: 'btn', 'data-sync': 'theirs', disabled: busy, onClick: () => choose('theirs') }, T.conflict.theirs), h('span', null, T.conflict.theirsText))),
      h(Note, null, T.conflict.note));
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
          h('button', { type: 'button', class: 'btn btn-small', 'data-sync': 'flush', onClick: () => { controller.engine?.flush(); } }, Icon('up'), T.pop.pushNow),
          h('button', { type: 'button', class: 'btn btn-small', onClick: () => { setOpen(false); openStorage(); } }, T.pop.storage))) : null);
  }

  // ---------- Liste der Dokumente der App ----------

  /** Zustand eines Dokuments in der Liste der App („Meine Matrizen“). @param {{ id: string }} props */
  function DocState({ id }) {
    const { config, sync } = useController(controller);
    if (!config || !sync) return null;
    const s = sync.docs[id] ?? 'pending';
    return h('span', { class: 'mcs-docstate' },
      h('span', { class: `mcs-state ${STATE_TONE[s]}`, 'data-doc-state': s }, Icon(STATE_ICON[s], 15), T.doc[s]),
      s === 'local' ? h('button', { type: 'button', class: 'btn btn-small', 'data-sync': 'upload', onClick: () => { controller.engine?.upload([id]); } }, Icon('up'), T.upload) : null,
      s === 'conflict' ? h('button', { type: 'button', class: 'btn btn-small', onClick: () => openConflict(id) }, T.solve) : null);
  }

  /** Abschnitt „Nur in der Ablage“ unter der Liste der App. */
  function RemoteOnly() {
    const { config, sync } = useController(controller);
    if (!config || !sync?.remoteOnly.length) return null;
    return h('div', { class: 'mcs-remote' },
      h('div', { class: 'mcs-h' }, T.remoteOnly),
      h('ul', { class: 'doc-list' }, sync.remoteOnly.map(d => h('li', { class: 'doc', key: d.id },
        h('div', { class: 'doc-info' }, h('span', { class: 'doc-title' }, d.title), h('span', { class: 'doc-meta' }, T.remoteMeta(when(d.savedAt), d.device, d.summary))),
        h('div', { class: 'doc-actions' }, h('button', {
          type: 'button', class: 'btn btn-small', 'data-sync': 'download',
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

  return {
    texts: T, StatusChip, DocState, RemoteOnly, openStorage, openConflict, closeDialog,
    /** Hinweis im Menü: Zustand der Ablage. */
    menuHint: () => (controller.state.config ? T.status[controller.state.sync?.status ?? 'idle'] : T.menu.notSet),
    /** Commit-Nachrichten in der Sprache der App (für die Engine). */
    messages: { save: T.commit.save, remove: T.commit.remove },
    toast,
  };
}

export { textsFor, APP_NAMES } from './texts.js';
