/**
 * 主题模式管理：浅色 / 深色 / 跟随系统。
 *
 * 职责边界：
 * - 本模块只负责「决定当前该用哪套配色」并把结果写到 `<html data-theme="...">`；
 *   具体色值全部由 src/styles/theme.css 定义，两者互不感知。
 * - 首屏防闪烁由 index.html 中的内联脚本完成（它在样式加载前同步执行）；
 *   本模块负责后续的切换、持久化与系统主题联动。
 *   ⚠️ 内联脚本里的存储键与解析逻辑须与本文件保持一致。
 *
 * 健壮性：localStorage / matchMedia 在隐私模式或旧环境下可能不可用或抛错，
 * 因此所有访问都做了降级处理，任何异常都不会影响页面渲染。
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** 存储键，需与 index.html 内联脚本一致 */
export const THEME_STORAGE_KEY = 'gt.theme';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** 读取已保存的模式，异常或非法值时回退到默认值 */
export function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** 系统是否偏好深色；matchMedia 不可用时视为浅色 */
export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** 由「模式 + 系统偏好」推导出实际配色 */
export function resolveTheme(mode: ThemeMode, prefersDark = systemPrefersDark()): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/** 订阅系统配色变化；返回取消订阅函数（matchMedia 不可用时为空操作） */
export function watchSystemTheme(handler: (prefersDark: boolean) => void): () => void {
  try {
    if (typeof window.matchMedia !== 'function') return () => undefined;
    const mql = window.matchMedia(DARK_QUERY);
    const listener = (e: MediaQueryListEvent): void => handler(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  } catch {
    return () => undefined;
  }
}

let currentMode: ThemeMode = DEFAULT_THEME_MODE;
let disposeTheme: (() => void) | null = null;
const listeners = new Set<(mode: ThemeMode, resolved: ResolvedTheme) => void>();

/** 把主题写到根元素（唯一直接操作 DOM 的地方） */
function paintTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

function notify(resolved: ResolvedTheme): void {
  listeners.forEach((cb) => cb(currentMode, resolved));
}

/** 应用模式：写 DOM + 持久化 + 通知订阅者 */
export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  currentMode = mode;
  const resolved = resolveTheme(mode);
  paintTheme(resolved);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 隐私模式下写不进去也不影响本次会话的显示
  }
  notify(resolved);
  return resolved;
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(currentMode);
}

/** 订阅主题变化，返回取消订阅函数 */
export function onThemeChange(cb: (mode: ThemeMode, resolved: ResolvedTheme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 启动主题：套用已保存的模式，并在「跟随系统」时响应系统配色切换，
 * 同时同步其它标签页的改动。返回清理函数（便于测试与热更新）。
 */
export function initTheme(): () => void {
  if (disposeTheme) return disposeTheme;

  currentMode = readStoredMode();
  paintTheme(resolveTheme(currentMode));

  // 直接采用事件负载中的新偏好，不再二次查询 matchMedia
  const disposeMedia = watchSystemTheme((prefersDark) => {
    if (currentMode !== 'system') return;
    const next: ResolvedTheme = prefersDark ? 'dark' : 'light';
    paintTheme(next);
    notify(next);
  });

  const onStorage = (e: StorageEvent): void => {
    if (e.key !== THEME_STORAGE_KEY) return;
    const next = isThemeMode(e.newValue) ? e.newValue : DEFAULT_THEME_MODE;
    if (next !== currentMode) setThemeMode(next);
  };
  window.addEventListener('storage', onStorage);

  disposeTheme = () => {
    disposeMedia();
    window.removeEventListener('storage', onStorage);
    disposeTheme = null;
  };
  return disposeTheme;
}
