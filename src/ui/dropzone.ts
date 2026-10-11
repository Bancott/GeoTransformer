import { el } from '@/ui/dom';

interface DropZoneBase {
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
}

/**
 * 两者的区别：
 * - `onFile`  逐文件回调，适合互不相干的单文件；
 * - `onFiles` 一次交付全部文件（自动开启多选），适合必须成组解析的 Shapefile。
 * 二者至少提供一个。
 */
export type DropZoneOptions = DropZoneBase &
  (
    | { onFiles: (files: File[]) => void; onFile?: (file: File) => void }
    | { onFile: (file: File) => void; onFiles?: (files: File[]) => void }
  );

/** 创建拖拽 + 点击选择文件的上传区 */
export function createDropZone(options: DropZoneOptions): HTMLElement {
  const multiple = options.multiple || !!options.onFiles;
  const input = el('input', {
    attrs: { type: 'file', accept: options.accept ?? '' },
    style: { display: 'none' },
  });
  if (multiple) input.multiple = true;

  const zone = el('div', {
    className: 'gt-dropzone',
    attrs: { tabindex: '0', role: 'button' },
    onClick: () => input.click(),
    onKeyup: (e) => {
      if (e.key === 'Enter' || e.key === ' ') input.click();
    },
  });

  const label = el(
    'div',
    { className: 'gt-dropzone__label', text: options.label ?? '点击或拖拽文件到此处' }
  );
  const hint = el('div', { className: 'gt-dropzone__hint', text: options.hint ?? '' });
  zone.append(label, hint, input);

  const handleFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (options.onFiles) {
      options.onFiles(list);
      return;
    }
    const single = options.onFile;
    if (single) list.forEach((f) => single(f));
  };

  input.onchange = () => {
    handleFiles(input.files);
    input.value = '';
  };

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('gt-dropzone--active');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('gt-dropzone--active'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('gt-dropzone--active');
    handleFiles(e.dataTransfer?.files ?? null);
  });

  return zone;
}

/** 读取文件为文本 */
export function readFileText(file: File): Promise<string> {
  return file.text();
}

/** 读取文件为 ArrayBuffer */
export function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
