import type { toast } from '@/ui/toast';
import type { downloadBlob, downloadText, downloadGeoJSON, formatBytes } from '@/ui/download';
import type { openModal } from '@/ui/modal';

export interface AppServices {
  toast: typeof toast;
  downloadBlob: typeof downloadBlob;
  downloadText: typeof downloadText;
  downloadGeoJSON: typeof downloadGeoJSON;
  formatBytes: typeof formatBytes;
  openModal: typeof openModal;
}

export type ToolCategory = 'format' | 'coord' | 'helper';

export const CATEGORY_META: Record<ToolCategory, { label: string; icon: string }> = {
  format: { label: '地理空间数据', icon: '⇄' },
  coord: { label: '坐标投影转换', icon: '◎' },
  helper: { label: '辅助工具', icon: '⌖' },
};

export interface ToolModule {
  id: string;
  title: string;
  subtitle: string;
  category: ToolCategory;
  /** 是否在功能上依赖地图交互（用于提示） */
  usesMap?: boolean;
  mount: (host: HTMLElement, svc: AppServices) => void | (() => void);
}
