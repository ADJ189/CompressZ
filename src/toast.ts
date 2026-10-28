export interface ToastAction {
  label: string;
  onClick: () => void;
}

/**
 * Show a transient toast. Passing an `action` (e.g. Undo) keeps it on screen
 * longer and renders a real button — clicking it runs the callback and
 * dismisses the toast immediately.
 */
export function toast(
  msg: string,
  type: 'success' | 'error' | '' = '',
  action?: ToastAction,
) {
  const container = document.getElementById('toast');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast-item' + (type ? ` ${type}` : '');
  el.style.opacity = '0';

  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);

  // Action toasts get longer to read and click than plain confirmations.
  const lifetime = action ? 8000 : 3500;
  let timer: number | undefined;

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

  container.appendChild(el);

  // anime.js pop-in/out is a progressive enhancement — the CSS class still
  // gives the toast its base styling either way, so a failed/slow dynamic
  // import just means an instant show/hide instead of a broken toast.
  // Deliberately fire-and-forget (the toast is synchronous API); `void` marks
  // the floating promise so neither the linter nor a reviewer mistakes it for
  // an accidentally unawaited operation.
  void import('./lib/motion').then(({ toastIn, toastOut }) => {
    toastIn(el);
    timer = window.setTimeout(() => { toastOut(el).then(() => el.remove()); }, lifetime);
  }).catch(() => {
    el.style.opacity = '1';
    timer = window.setTimeout(() => el.remove(), lifetime);
  });
}
