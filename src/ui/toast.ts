import { el } from '@/ui/dom';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

const ICONS: Record<ToastType, string> = {
  success: '✔',
  error: '✘',
  info: 'ℹ',
  warning: '⚠',
};

/** 简单的右上角通知，自动消失 */
export function toast(message: string, type: ToastType = 'info', duration = 2600): void {
  const host = document.getElementById('gt-toast-host');
  if (!host) return;
  const item = el('div', { className: `gt-toast gt-toast--${type}` });
  item.innerHTML = `<span class="gt-toast__icon">${ICONS[type]}</span><span class="gt-toast__msg"></span>`;
  (item.querySelector('.gt-toast__msg') as HTMLElement).textContent = message;
  host.appendChild(item);
  requestAnimationFrame(() => item.classList.add('gt-toast--show'));
  window.setTimeout(() => {
    item.classList.remove('gt-toast--show');
    window.setTimeout(() => item.remove(), 300);
  }, duration);
}
