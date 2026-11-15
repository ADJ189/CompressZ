export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /**
   * Bounded engine log to render behind a "Details" disclosure. Only
   * `EngineError` produces one, and it is the only way a user can see why an
   * engine refused a file after the toast's one-line summary.
   */
  log?: string[];
}

export type ToastType = 'success' | 'error' | 'info' | 'warn' | '';

/**
 * Show a transient toast. Passing an `action` (e.g. Undo) keeps it on screen
 * longer and renders a real button — clicking it runs the callback and
 * dismisses the toast immediately.
 *
 * `options.log` adds a collapsed, expandable log block. Every value is written
 * with `textContent`, so engine output can never inject markup.
 */
export function toast(
  msg: string,
  type: ToastType = '',
  action?: ToastAction,
  options?: ToastOptions,
) {
  const container = document.getElementById('toast');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast-item' + (type ? ` ${type}` : '');
  el.style.opacity = '0';

  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);

  const log = options?.log?.filter((line) => line.trim().length > 0) ?? [];
  const hasLog = log.length > 0;

  // Action toasts get longer to read and click than plain confirmations; a
  // toast that carries an engine log stays long enough to open "Details".
  const lifetime = action ? 8000 : hasLog ? 12000 : 3500;
  let timer: number | undefined;

  if (hasLog) {
    const details = document.createElement('details');
    details.className = 'cz-toast-details';

    const summary = document.createElement('summary');
    summary.textContent = `Details (${log.length} line${log.length === 1 ? '' : 's'})`;
    details.appendChild(summary);

    const pre = document.createElement('pre');
    pre.textContent = log.join('\n');
    details.appendChild(pre);

    el.appendChild(details);
    el.classList.add('has-details');
  }

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cz-toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      window.clearTimeout(timer);
      action.onClick();
      el.remove();
    });
    el.appendChild(btn);
  }

  if (hasLog) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cz-toast-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      window.clearTimeout(timer);
      el.remove();
    });
    el.appendChild(close);
  }

  container.appendChild(el);

  // anime.js pop-in/out is a progressive enhancement — the CSS class still
  // gives the toast its base styling either way, so a failed/slow dynamic
  // import just means an instant show/hide instead of a broken toast.
  // Deliberately fire-and-forget (the toast is synchronous API); `void` marks
  // the floating promise so neither the linter nor a reviewer mistakes it for
  // an accidentally unawaited operation.
  void import('./lib/motion').then(({ toastIn, toastOut }) => {
    toastIn(el);
    timer = window.setTimeout(() => {
      void toastOut(el).then(() => el.remove()).catch(() => el.remove());
    }, lifetime);
  }).catch(() => {
    el.style.opacity = '1';
    timer = window.setTimeout(() => el.remove(), lifetime);
  });
}
