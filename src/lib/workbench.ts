/**
 * workbench.ts — the compact home workbench.
 *
 * Owns the three pieces of home that are stateful:
 *   1. tool search/filter (client-side, no index, nothing leaves the device),
 *   2. pinned + recently-used tools (`cz-favourite-tools`, `cz-recent-tools`),
 *   3. the live processing-queue summary fed by the Adaptive Resource Guard.
 *
 * The static markup lives in `index.html` (`#tpl-home`) so the page is useful
 * before this module runs; every hook here is progressive enhancement.
 */
import {
  getResourceSnapshot,
  subscribeResource,
  type ResourceSnapshot,
} from './resourceManager';
import { getFavourites, getRecents, toggleFavourite } from './recents';
import { navigate } from '../router';

const MAX_RECENT = 5;

interface ToolMeta {
  route: string;
  icon: string;
  name: string;
  keywords: string;
  el: HTMLElement;
}

function readTools(root: HTMLElement): ToolMeta[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-wb-tool]'),
  ).map((el) => ({
    route: el.dataset.nav ?? '',
    icon: el.dataset.icon ?? '•',
    name: el.dataset.label ?? el.textContent?.trim() ?? '',
    keywords: (el.dataset.keywords ?? '').toLowerCase(),
    el,
  }));
}

let queueUnsub: (() => void) | null = null;

function renderQueue(host: HTMLElement, snapshot: ResourceSnapshot): void {
  host.innerHTML = '';

  const status = document.createElement('div');
  status.className = 'cz-wb-queue__status';

  const dot = document.createElement('span');
  dot.className = `cz-wb-queue__dot${snapshot.jobs.length ? ' is-active' : ''}`;
  dot.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  const running = snapshot.activeHeavy + snapshot.activeLight;
  label.textContent = snapshot.jobs.length
    ? `${running} running · ${snapshot.queued} queued · ${snapshot.estimateLabel} load`
    : 'Idle — nothing is being processed';

  status.append(dot, label);
  host.appendChild(status);

  if (snapshot.jobs.length) {
    const list = document.createElement('ul');
    list.className = 'cz-wb-queue__list';
    for (const job of snapshot.jobs.slice(0, 4)) {
      const item = document.createElement('li');
      item.className = 'cz-wb-queue__item';

      const name = document.createElement('span');
      name.className = 'cz-wb-queue__name';
      name.textContent = job.label;

      const state = document.createElement('span');
      state.className = `cz-wb-queue__state is-${job.state}`;
      state.textContent =
        job.state === 'running'
          ? `${job.workload} · running`
          : `${job.workload} · queued`;

      item.append(name, state);
      list.appendChild(item);
    }
    host.appendChild(list);
  }

  const hint = document.createElement('p');
  hint.className = 'cz-wb-queue__hint';
  hint.textContent = `${snapshot.modeLabel} · ${snapshot.concurrencyLabel}${
    snapshot.engineHint !== 'Idle' ? ` · ${snapshot.engineHint}` : ''
  }`;
  host.appendChild(hint);

  if (snapshot.pressureReason) {
    const pressure = document.createElement('p');
    pressure.className = 'cz-wb-queue__pressure';
    pressure.textContent = snapshot.pressureReason;
    host.appendChild(pressure);
  }
}

/** Wire the home workbench. Safe to call on every visit; replaces listeners. */
export function mountWorkbench(root: HTMLElement): void {
  // One mount per rendered host. A late dynamic-import callback must not wire
  // the same markup twice (duplicate search/star/queue handlers).
  if (root.dataset.wbMounted === '1') return;
  root.dataset.wbMounted = '1';

  const tools = readTools(root);
  const byRoute = new Map(tools.map((tool) => [tool.route, tool]));
  const quickCards = Array.from(
    root.querySelectorAll<HTMLElement>('[data-wb-quick]'),
  );

  const search = root.querySelector<HTMLInputElement>('#wb-search');
  const filter = root.querySelector<HTMLInputElement>('#wb-filter');
  const empty = root.querySelector<HTMLElement>('#wb-empty');
  const pinnedHost = root.querySelector<HTMLElement>('#wb-pinned');
  const queueHost = root.querySelector<HTMLElement>('#wb-queue');

  // ── Filtering ────────────────────────────────────────────────
  function applyFilter(query: string) {
    const q = query.trim().toLowerCase();
    const matches = (name: string, keywords: string) =>
      !q || name.toLowerCase().includes(q) || keywords.includes(q);

    let visible = 0;
    for (const tool of tools) {
      const match = matches(tool.name, tool.keywords);
      tool.el.hidden = !match;
      if (match) visible++;
    }
    for (const card of quickCards) {
      card.hidden = !matches(
        card.dataset.label ?? '',
        (card.dataset.keywords ?? '').toLowerCase(),
      );
    }
    if (empty) empty.hidden = visible > 0;
    return tools.filter((tool) => !tool.el.hidden);
  }

  function onSearchInput(value: string) {
    if (filter && filter.value !== value) filter.value = value;
    if (search && search.value !== value) search.value = value;
    applyFilter(value);
  }

  search?.addEventListener('input', () => onSearchInput(search.value));
  filter?.addEventListener('input', () => onSearchInput(filter.value));

  for (const input of [search, filter]) {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const first = applyFilter(input.value)[0];
      if (!first) return;
      event.preventDefault();
      navigate(first.route);
    });
  }

  // ── Favourites ───────────────────────────────────────────────
  for (const tool of tools) {
    const star = tool.el.querySelector<HTMLButtonElement>('[data-wb-fav]');
    if (!star) continue;
    const sync = () => {
      const on = getFavourites().includes(tool.route);
      star.classList.toggle('is-on', on);
      star.setAttribute('aria-pressed', String(on));
      star.setAttribute('aria-label', `${on ? 'Unpin' : 'Pin'} ${tool.name}`);
      star.textContent = on ? '★' : '☆';
    };
    sync();
    star.addEventListener('click', (event) => {
      // The card is already a [data-nav] target, and the router's delegated
      // handler ignores events whose default was prevented.
      event.preventDefault();
      event.stopPropagation();
      toggleFavourite(tool.route);
      sync();
      renderPinned();
    });
  }

  // ── Pinned + recent ──────────────────────────────────────────
  function chip(route: string, kind: 'fav' | 'recent'): HTMLElement | null {
    const tool = byRoute.get(route);
    if (!tool) return null;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cz-wb-chip is-${kind}`;
    el.dataset.nav = route;
    el.innerHTML = `<span class="cz-wb-chip__icon" aria-hidden="true">${tool.icon}</span><span>${tool.name}</span>`;
    return el;
  }

  function renderPinned() {
    if (!pinnedHost) return;
    pinnedHost.innerHTML = '';

    const favourites = getFavourites();
    const recents = getRecents()
      .filter((r) => !favourites.includes(r))
      .slice(0, MAX_RECENT);
    const shown = [
      ...favourites.map((r) => chip(r, 'fav')),
      ...recents.map((r) => chip(r, 'recent')),
    ].filter((el): el is HTMLElement => el !== null);

    if (!shown.length) {
      const hint = document.createElement('p');
      hint.className = 'cz-wb-empty';
      hint.textContent =
        'Pin a tool with ☆ and it will stay here. Recently used tools appear automatically.';
      pinnedHost.appendChild(hint);
      return;
    }

    pinnedHost.append(...shown);
  }

  renderPinned();

  // ── Live queue ───────────────────────────────────────────────
  if (queueHost) {
    queueUnsub?.();
    const paint = () => renderQueue(queueHost, getResourceSnapshot());
    paint();
    queueUnsub = subscribeResource(paint);
  }
}
