// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  THEME_STORAGE_KEY,
  DEFAULT_THEME_MODE,
  isThemeMode,
  readStoredMode,
  resolveTheme,
  setThemeMode,
  getThemeMode,
  onThemeChange,
  initTheme,
} from '@/ui/theme';

function setStored(value: string | null): void {
  if (value === null) localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, value);
}

/** 可控的 matchMedia 替身：真实维护监听器集合，便于验证取消订阅 */
function createFakeMatchMedia(initial: boolean) {
  const handlers = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => void handlers.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => void handlers.delete(cb),
  };
  return {
    mql,
    emit(matches: boolean): void {
      mql.matches = matches;
      handlers.forEach((cb) => cb({ matches }));
    },
    listenerCount: () => handlers.size,
  };
}

function installMatchMedia(fake: ReturnType<typeof createFakeMatchMedia>): () => void {
  const original = window.matchMedia;
  window.matchMedia = (() => fake.mql) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe('isThemeMode', () => {
  it('只接受三个合法模式', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('DARK')).toBe(false);
    expect(isThemeMode('')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe('readStoredMode', () => {
  beforeEach(() => localStorage.clear());

  it('未设置时回退到跟随系统', () => {
    expect(readStoredMode()).toBe(DEFAULT_THEME_MODE);
  });

  it('读取已保存的模式', () => {
    setStored('dark');
    expect(readStoredMode()).toBe('dark');
  });

  it('存了非法值时回退到默认值', () => {
    setStored('purple');
    expect(readStoredMode()).toBe(DEFAULT_THEME_MODE);
  });

  it('localStorage 抛错时不影响调用方', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => readStoredMode()).not.toThrow();
    expect(readStoredMode()).toBe(DEFAULT_THEME_MODE);
    spy.mockRestore();
  });
});

describe('resolveTheme', () => {
  it('固定模式直接返回自身', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('跟随系统时按系统偏好决定', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('setThemeMode', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('写入根元素属性并持久化', () => {
    const resolved = setThemeMode('dark');
    expect(resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('切回浅色时同步更新属性与存储', () => {
    setThemeMode('dark');
    setThemeMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getThemeMode()).toBe('light');
  });

  it('写入存储失败不抛出异常', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setThemeMode('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    spy.mockRestore();
  });

  it('通知订阅者，且可取消订阅', () => {
    const seen: string[] = [];
    const off = onThemeChange((mode, resolved) => seen.push(`${mode}:${resolved}`));
    setThemeMode('dark');
    setThemeMode('light');
    off();
    setThemeMode('dark');
    expect(seen).toEqual(['dark:dark', 'light:light']);
  });
});

describe('initTheme', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('按已保存的模式初始化根元素', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const dispose = initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    dispose();
  });

  it('清理函数可重复调用而不报错', () => {
    const dispose = initTheme();
    dispose();
    expect(() => dispose()).not.toThrow();
  });

  it('系统配色变化时，跟随系统模式会重绘', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const mql = createFakeMatchMedia(false);
    const restore = installMatchMedia(mql);

    const dispose = initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    // 模拟系统切到深色
    mql.emit(true);
    expect(document.documentElement.dataset.theme).toBe('dark');

    // 清理后不应再响应
    dispose();
    mql.emit(false);
    expect(document.documentElement.dataset.theme).toBe('dark');

    restore();
  });

  it('固定模式下忽略系统配色变化', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const mql = createFakeMatchMedia(false);
    const restore = installMatchMedia(mql);

    const dispose = initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    mql.emit(true);
    // 用户显式选择了浅色，不应被系统偏好覆盖
    expect(document.documentElement.dataset.theme).toBe('light');

    restore();
    dispose();
  });
});
