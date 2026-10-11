import { el } from '@/ui/dom';
import { openModal } from '@/ui/modal';
import { toast } from '@/ui/toast';
import { createThemeSwitch } from '@/ui/themeSwitch';
import * as download from '@/ui/download';
import { createDonateButton } from '@/modules/donation';
import type { AppServices, ToolModule } from '@/toolRegistry';
import { CATEGORY_META } from '@/toolRegistry';
import { formatConvertTool } from '@/tools/formatConvert';
import { coordConvertTool } from '@/tools/coordConvert';
import { coordFormatTool } from '@/tools/coordFormatTool';
import { reprojectTool } from '@/tools/reprojectTool';
import { pickerTool } from '@/tools/picker';
import { detectorTool } from '@/tools/detector';
import { previewerTool } from '@/tools/previewer';

const TOOLS: ToolModule[] = [
  formatConvertTool,
  coordConvertTool,
  reprojectTool,
  coordFormatTool,
  pickerTool,
  detectorTool,
  previewerTool,
];

const SERVICES: AppServices = {
  toast,
  downloadBlob: download.downloadBlob,
  downloadText: download.downloadText,
  downloadGeoJSON: download.downloadGeoJSON,
  formatBytes: download.formatBytes,
  openModal,
};

function openAbout(): void {
  const c = el('div', { className: 'gt-about' });
  c.innerHTML =
    '<p><b>GeoTransformer · 地理数据处理箱</b> 是一个完全在浏览器端运行的地理数据处理工具集。</p>' +
    '<div class="gt-about__sec"><b>主要功能</b>' +
    '<ul>' +
    '<li>地理空间数据：GeoJSON ↔ Shapefile / KML / TopoJSON / WKT / WKB / GPX / GML / DXF / OSM XML，CSV(含坐标)→GeoJSON，Excel→GeoJSON，PostGIS→GeoJSON</li>' +
    '<li>坐标投影转换：WGS-84 / GCJ-02 / BD-09 / CGCS2000 / PZ-90 / GRS-80 多坐标系互转（单点、批量、文件）</li>' +
    '<li>投影坐标转换：EPSG 之间转换（如 3857 ↔ 4326），支持自定义 proj4 与 GCJ/BD 墨卡托</li>' +
    '<li>坐标格式解析：DMS / 度分 / 十进制 / UTM / MGRS 互转</li>' +
    '<li>坐标拾取器：点击地图获取坐标并实时换算坐标系</li>' +
    '<li>坐标系检测器：启发式判断 WGS-84 / GCJ-02 / BD-09，并支持地图参考点校准</li>' +
    '<li>数据预览器：拖入文件自动渲染地图与属性表，可指明源坐标系（WGS-84 / GCJ-02 / BD-09）</li>' +
    '</ul></div>' +
    '<div class="gt-about__sec"><b>隐私</b><p>所有数据都在你的浏览器本地处理，不会上传到任何服务器。</p></div>' +
    '<div class="gt-about__sec"><b>技术栈</b><p>TypeScript · Vite · Leaflet · proj4 · shpjs · TopoJSON · @tmcw/togeojson · xlsx · mgrs · Vitest（单元测试）</p></div>' +
    '<div class="gt-about__sec"><b>许可</b><p>开源项目，遵循 MIT License。欢迎在 GitHub 上反馈问题或贡献代码。</p></div>';
  openModal({ title: '关于 GeoTransformer', content: c, width: 'min(560px, 94vw)' });
}

export function createApp(root: HTMLElement): void {
  // 头部
  const brand = el('div', { className: 'gt-brand' });
  brand.innerHTML =
    '<div class="gt-brand__logo"><svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg></div>' +
    '<div class="gt-brand__text"><h1>GeoTransformer</h1><p>地理数据处理箱</p></div>';

  const aboutBtn = el('button', { className: 'gt-btn gt-btn--ghost', text: '关于', onClick: openAbout });
  const gh = el('a', { className: 'gt-btn gt-btn--ghost', text: 'GitHub', attrs: { href: 'https://github.com/your-name/geo-transformer', target: '_blank', rel: 'noopener' } });
  const headerActions = el('div', { className: 'gt-header__actions' }, createThemeSwitch(), gh, aboutBtn, createDonateButton());
  const header = el('header', { className: 'gt-header' }, brand, headerActions);

  // 侧边栏：分类标题是可读的分组标签（不可交互），工具项才是按钮
  const sidebar = el('aside', { className: 'gt-sidebar' });
  const sidebarBody = el('nav', { className: 'gt-sidebar__nav', attrs: { 'aria-label': '功能模块' } });
  const categoryOrder: Array<keyof typeof CATEGORY_META> = ['format', 'coord', 'helper'];

  const toolButtons: Record<string, HTMLElement> = {};
  categoryOrder.forEach((cat) => {
    const meta = CATEGORY_META[cat];
    const group = el('div', {
      className: 'gt-nav-group',
      attrs: { role: 'group', 'aria-label': meta.label },
    });
    // 视觉分组标题；aria-hidden 让读屏软件只用 group 的 aria-label，避免重复朗读
    const catEl = el('div', { className: 'gt-cat', attrs: { 'aria-hidden': 'true' } });
    catEl.innerHTML = `<span class="gt-cat__icon">${meta.icon}</span><span>${meta.label}</span>`;
    group.appendChild(catEl);
    TOOLS.filter((t) => t.category === cat).forEach((tool) => {
      const item = el('button', {
        className: 'gt-nav-item',
        text: tool.title,
        onClick: () => activate(tool),
      });
      toolButtons[tool.id] = item;
      group.appendChild(item);
    });
    sidebarBody.appendChild(group);
  });
  sidebar.appendChild(sidebarBody);

  // 主区域
  const toolTitle = el('h2', { className: 'gt-tool-title' });
  const toolSub = el('p', { className: 'gt-tool-sub' });
  const toolBody = el('div', { className: 'gt-tool-body' });
  const main = el('main', { className: 'gt-main' }, toolTitle, toolSub, toolBody);

  const layout = el('div', { className: 'gt-layout' }, sidebar, main);

  const toastHost = el('div', { id: 'gt-toast-host', className: 'gt-toast-host' });

  let cleanup: (() => void) | undefined;

  function activate(tool: ToolModule): void {
    cleanup?.();
    toolTitle.textContent = tool.title;
    toolSub.textContent = tool.subtitle;
    Object.entries(toolButtons).forEach(([id, btn]) => btn.classList.toggle('gt-nav-item--active', id === tool.id));
    // 清空并重新挂载
    toolBody.replaceChildren();
    const mountResult = tool.mount(toolBody, SERVICES);
    cleanup = typeof mountResult === 'function' ? mountResult : undefined;
  }

  root.append(header, layout, toastHost);
  activate(TOOLS[0]);
}
