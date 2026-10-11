/** 轻量级 DOM 创建辅助 */

type Child = Node | string | null | undefined | false | 0;

export interface ElProps {
  className?: string;
  id?: string;
  text?: string | number;
  html?: string;
  title?: string;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string | number | boolean>;
  onClick?: (this: HTMLElement, e: MouseEvent) => void;
  onChange?: (this: HTMLElement, e: Event) => void;
  onInput?: (this: HTMLElement, e: Event) => void;
  onKeyup?: (this: HTMLElement, e: KeyboardEvent) => void;
  onDragOver?: (this: HTMLElement, e: DragEvent) => void;
  onDragLeave?: (this: HTMLElement, e: DragEvent) => void;
  onDrop?: (this: HTMLElement, e: DragEvent) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props);
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === 0) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      node.appendChild(document.createTextNode(String(c)));
    } else {
      node.appendChild(c);
    }
  }
  return node;
}

export function elById<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error('缺少元素 #' + id);
  return n as T;
}

function applyProps(node: HTMLElement, props: ElProps): void {
  if (props.id) node.id = props.id;
  if (props.className) node.className = props.className;
  if (props.title) node.title = props.title;
  if (props.text !== undefined) node.textContent = String(props.text);
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.dataset) for (const k of Object.keys(props.dataset)) node.dataset[k] = props.dataset[k];
  if (props.style) Object.assign(node.style, props.style);
  if (props.attrs) {
    for (const k of Object.keys(props.attrs)) {
      const v = props.attrs[k];
      if (v === false) node.removeAttribute(k);
      else node.setAttribute(k, String(v));
    }
  }
  const bind = (type: string, handler: (e: never) => void): void =>
    node.addEventListener(type, handler as EventListener);
  if (props.onClick) bind('click', props.onClick as never);
  if (props.onChange) bind('change', props.onChange as never);
  if (props.onInput) bind('input', props.onInput as never);
  if (props.onKeyup) bind('keyup', props.onKeyup as never);
  if (props.onDragOver) bind('dragover', props.onDragOver as never);
  if (props.onDragLeave) bind('dragleave', props.onDragLeave as never);
  if (props.onDrop) bind('drop', props.onDrop as never);
}

/** 便捷：清空节点 */
export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
