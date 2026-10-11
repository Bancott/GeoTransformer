import { el, clear } from '@/ui/dom';

interface ModalOptions {
  title: string;
  content: Node | HTMLElement | (() => Node);
  width?: string;
  onClose?: () => void;
}

function buildModal(options: ModalOptions): { root: HTMLElement; close: () => void } {
  const overlay = el('div', { className: 'gt-modal-overlay' });
  const box = el('div', { className: 'gt-modal', style: { width: options.width ?? 'min(520px, 92vw)' } });
  const head = el('div', { className: 'gt-modal__head' });
  const title = el('h3', { className: 'gt-modal__title', text: options.title });
  const closeBtn = el('button', {
    className: 'gt-modal__close',
    html: '&times;',
    attrs: { 'aria-label': '关闭' },
    onClick: () => close(),
  });
  head.append(title, closeBtn);

  const body = el('div', { className: 'gt-modal__body' });
  const content = typeof options.content === 'function' ? options.content() : options.content;
  body.appendChild(content as Node);

  box.append(head, body);
  overlay.appendChild(box);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    options.onClose?.();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // ESC 关闭
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onEsc);
  const origOnClose = options.onClose;
  options.onClose = () => {
    document.removeEventListener('keydown', onEsc);
    origOnClose?.();
  };

  document.body.appendChild(overlay);
  document.body.classList.add('gt-modal-open');
  (box.querySelector('.gt-modal__close') as HTMLElement).focus();
  return { root: box, close };
}

export function openModal(options: ModalOptions): { close: () => void } {
  return buildModal(options);
}

export function closeModalHost(): void {
  clear(document.querySelector('.gt-modal-overlay') as HTMLElement);
  document.body.classList.remove('gt-modal-open');
}
