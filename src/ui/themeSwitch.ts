import { segmented, type SegmentedOption } from '@/ui/form';
import { THEME_MODES, getThemeMode, setThemeMode, type ThemeMode } from '@/ui/theme';

/** 16×16 线性图标（跟随 currentColor，自动适配主题） */
const svg = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const ICONS: Record<ThemeMode, string> = {
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  dark: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  system: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
};

/** 顶部主题切换控件：浅色 / 深色 / 跟随系统 */
export function createThemeSwitch(): HTMLElement {
  const options: SegmentedOption[] = THEME_MODES.map((m) => ({
    value: m.value,
    label: m.label,
    icon: ICONS[m.value],
  }));
  return segmented(options, getThemeMode(), (value) => setThemeMode(value as ThemeMode), '配色模式');
}
