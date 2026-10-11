import { el } from '@/ui/dom';

export function field(labelText: string, control: Node, hint?: string): HTMLElement {
  const wrap = el('label', { className: 'gt-field' });
  const lab = el('span', { className: 'gt-field__label', text: labelText });
  wrap.append(lab, control);
  if (hint) wrap.appendChild(el('span', { className: 'gt-field__hint', text: hint }));
  return wrap;
}

export interface SelectOption {
  value: string;
  label: string;
  /** 可选分组名：同名选项归入同一个 <optgroup> */
  group?: string;
}

export function select(
  options: SelectOption[],
  onChange?: (value: string) => void,
  initial?: string
): HTMLSelectElement {
  const sel = el('select', { className: 'gt-input' });
  fillSelect(sel, options, initial);
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** 重建下拉框选项（用于选项随上下文变化的场景），返回是否成功选中 initial */
export function fillSelect(
  sel: HTMLSelectElement,
  options: SelectOption[],
  initial?: string
): boolean {
  sel.replaceChildren();

  // 同名 group 归入同一个 optgroup（不要求选项在数组中相邻），
  // 分组顺序按首次出现决定，未分组的选项直接挂在 select 下。
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const o of options) {
    const option = el('option', { attrs: { value: o.value }, text: o.label });
    if (o.group === undefined) {
      sel.appendChild(option);
      continue;
    }
    let group = groups.get(o.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = o.group;
      sel.appendChild(group);
      groups.set(o.group, group);
    }
    group.appendChild(option);
  }

  if (initial !== undefined && options.some((o) => o.value === initial)) {
    sel.value = initial;
    return true;
  }
  if (options.length) sel.value = options[0].value;
  return false;
}

export function textInput(
  placeholder?: string,
  onChange?: (value: string) => void,
  type = 'text'
): HTMLInputElement {
  const input = el('input', {
    className: 'gt-input',
    attrs: { type, placeholder: placeholder ?? '' },
  });
  if (onChange) input.addEventListener('input', () => onChange(input.value));
  return input;
}

export function textArea(
  placeholder?: string,
  rows = 6,
  onChange?: (value: string) => void
): HTMLTextAreaElement {
  const area = el('textarea', {
    className: 'gt-input gt-textarea',
    attrs: { placeholder: placeholder ?? '', rows: String(rows) },
  });
  if (onChange) area.addEventListener('input', () => onChange(area.value));
  return area;
}

export type ButtonKind = 'primary' | 'ghost' | 'danger';

export function button(
  text: string,
  onClick?: (e: MouseEvent) => void,
  kind: ButtonKind = 'primary'
): HTMLButtonElement {
  return el('button', {
    className: `gt-btn gt-btn--${kind}`,
    text,
    onClick,
  });
}

export function iconButton(html: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  return el('button', { className: 'gt-icon-btn', html, title, onClick });
}

export function card(title: string, children: Node[], bodyClass = ''): HTMLElement {
  const head = el('div', { className: 'gt-card__head', text: title });
  const body = el('div', { className: `gt-card__body ${bodyClass}`.trim() });
  children.forEach((c) => body.appendChild(c));
  return el('div', { className: 'gt-card' }, head, body);
}

/** 副标题/说明段落 */
export function note(text: string): HTMLElement {
  return el('p', { className: 'gt-note', text });
}

export interface SegmentedOption {
  value: string;
  /** 无障碍名称与提示文字（窄屏隐藏可见文字时仍可被读出） */
  label: string;
  /** 可选的内联 SVG / HTML 图标 */
  icon?: string;
}

/**
 * 分段控件（单选）。语义为 radiogroup，支持左右方向键切换。
 * 适用于选项少、需要一眼看出当前值的场景（如主题模式）。
 * 注意：初始化时**不会**触发 onChange，只有用户操作才会。
 */
export function segmented(
  options: SegmentedOption[],
  value: string,
  onChange: (value: string) => void,
  ariaLabel?: string
): HTMLElement {
  const group = el('div', {
    className: 'gt-segmented',
    attrs: { role: 'radiogroup', ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) },
  });
  const items: HTMLButtonElement[] = [];

  const apply = (next: string, focus = false, notify = true): void => {
    if (!options.some((o) => o.value === next)) return;
    items.forEach((btn, i) => {
      const active = options[i].value === next;
      btn.setAttribute('aria-checked', String(active));
      btn.tabIndex = active ? 0 : -1;
      if (active && focus) btn.focus();
    });
    if (notify) onChange(next);
  };

  options.forEach((opt, index) => {
    const btn = el('button', {
      className: 'gt-segmented__item',
      attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': opt.label, title: opt.label },
      onClick: () => apply(opt.value),
    });
    if (opt.icon) btn.appendChild(el('span', { className: 'gt-segmented__icon', html: opt.icon }));
    btn.appendChild(el('span', { className: 'gt-segmented__label', text: opt.label }));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      apply(options[(index + delta + options.length) % options.length].value, true);
    });
    items.push(btn);
    group.appendChild(btn);
  });

  apply(value, false, false);
  return group;
}
