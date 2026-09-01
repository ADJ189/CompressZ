export function toast(msg: string, type: 'success' | 'error' | '' = '') {
  const container = document.getElementById('toast')!;
  const el = document.createElement('div');
  el.className = 'toast-item' + (type ? ` ${type}` : '');
  el.style.opacity = '0';
  el.textContent = msg;
  container.appendChild(el);

  // anime.js pop-in/out is a progressive enhancement — the CSS class still
  // gives the toast its base styling either way, so a failed/slow dynamic
  // import just means an instant show/hide instead of a broken toast.
  import('./lib/motion').then(({ toastIn, toastOut }) => {
    toastIn(el);
    setTimeout(() => { toastOut(el).then(() => el.remove()); }, 3500);
  }).catch(() => {
    el.style.opacity = '1';
    setTimeout(() => el.remove(), 3500);
  });
}
