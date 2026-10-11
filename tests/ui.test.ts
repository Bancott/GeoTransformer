// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { segmented, fillSelect, select } from '@/ui/form';

const OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

function itemsOf(group: HTMLElement): HTMLButtonElement[] {
  return Array.from(group.querySelectorAll<HTMLButtonElement>('.gt-segmented__item'));
}

function checkedValue(group: HTMLElement): string | undefined {
  const opts = OPTIONS.map((o) => o.value);
  const idx = itemsOf(group).findIndex((b) => b.getAttribute('aria-checked') === 'true');
  return idx >= 0 ? opts[idx] : undefined;
}

describe('segmented', () => {
  it('渲染全部选项并标记当前值', () => {
    const group = segmented(OPTIONS, 'dark', () => undefined, '配色模式');
    expect(itemsOf(group)).toHaveLength(3);
    expect(checkedValue(group)).toBe('dark');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('配色模式');
    expect(itemsOf(group)[1].getAttribute('role')).toBe('radio');
  });

  it('初始化时不触发 onChange', () => {
    const onChange = vi.fn();
    segmented(OPTIONS, 'system', onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('点击选项时回调并更新选中态', () => {
    const onChange = vi.fn();
    const group = segmented(OPTIONS, 'light', onChange);
    itemsOf(group)[1].click();
    expect(onChange).toHaveBeenCalledWith('dark');
    expect(checkedValue(group)).toBe('dark');
  });

  it('重复点击当前项也会回调（幂等，由调用方决定是否处理）', () => {
    const onChange = vi.fn();
    const group = segmented(OPTIONS, 'light', onChange);
    itemsOf(group)[0].click();
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('仅当前项可被 Tab 聚焦（roving tabindex）', () => {
    const group = segmented(OPTIONS, 'dark', () => undefined);
    expect(itemsOf(group).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('方向键循环切换并移动焦点', () => {
    const onChange = vi.fn();
    const group = segmented(OPTIONS, 'light', onChange);
    const items = itemsOf(group);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    // 末项再右移回到首项
    items[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('light');
    // 首项左移跳到末项
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('system');
  });

  it('忽略非方向键', () => {
    const onChange = vi.fn();
    const group = segmented(OPTIONS, 'light', onChange);
    itemsOf(group)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('传入非法初始值时选中第一项', () => {
    const group = segmented(OPTIONS, 'nope', () => undefined);
    expect(itemsOf(group).every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
  });
});

describe('fillSelect', () => {
  const opts = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];

  it('重建选项并选中指定值', () => {
    const sel = select(opts, () => undefined, 'a');
    expect(fillSelect(sel, opts, 'b')).toBe(true);
    expect(sel.value).toBe('b');
    expect(sel.options).toHaveLength(2);
  });

  it('目标值不存在时回退到第一项', () => {
    const sel = select(opts, () => undefined, 'a');
    expect(fillSelect(sel, opts, 'zzz')).toBe(false);
    expect(sel.value).toBe('a');
  });

  it('重复调用不会累积旧选项', () => {
    const sel = select(opts, () => undefined, 'a');
    fillSelect(sel, opts, 'a');
    fillSelect(sel, opts, 'a');
    expect(sel.options).toHaveLength(2);
  });

  it('同名 group 归入同一个 optgroup（即使选项不相邻）', () => {
    const grouped = [
      { value: '1', label: '经纬度 A', group: '地理坐标系' },
      { value: '2', label: '投影 A', group: '投影坐标系' },
      { value: '3', label: '经纬度 B', group: '地理坐标系' },
      { value: '4', label: '投影 B', group: '投影坐标系' },
    ];
    const sel = select(grouped, () => undefined, '1');
    const groups = Array.from(sel.children).filter((n) => n.tagName === 'OPTGROUP');
    expect(groups.map((g) => (g as HTMLOptGroupElement).label)).toEqual(['地理坐标系', '投影坐标系']);
    expect(groups[0].children).toHaveLength(2);
    expect(groups[1].children).toHaveLength(2);
    // 选中态与取值不受分组影响
    expect(sel.value).toBe('1');
    sel.value = '4';
    expect(sel.options).toHaveLength(4);
  });

  it('未分组的选项直接挂在 select 下', () => {
    const sel = select([{ value: 'x', label: 'X' }], () => undefined, 'x');
    expect(Array.from(sel.children).map((n) => n.tagName)).toEqual(['OPTION']);
  });
});
