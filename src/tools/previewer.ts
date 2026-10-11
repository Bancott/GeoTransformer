import type { FeatureCollection } from 'geojson';
import { el, clear } from '@/ui/dom';
import { card, field, note, select } from '@/ui/form';
import { MapController } from '@/map/mapController';
import { parseFilesToFeatureCollection, type Parsed } from '@/tools/fileParsers';
import { createDropZone } from '@/ui/dropzone';
import { collectCoords, detectFromCoords } from '@/core/detect';
import type { CoordSystem } from '@/core/types';
import type { ToolModule } from '@/toolRegistry';

function buildAttrTable(fc: FeatureCollection): HTMLElement {
  const features = fc.features;
  const keys = new Set<string>();
  features.slice(0, 500).forEach((f) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    Object.keys(p).forEach((k) => keys.add(k));
  });
  const keyArr = Array.from(keys).slice(0, 40);
  if (keyArr.length === 0) {
    return el('div', { className: 'gt-trunc', text: '（要素无属性）' });
  }
  const table = el('table', { className: 'gt-table' });
  const thead = el('thead');
  thead.innerHTML = '<tr><th>#</th>' + keyArr.map((k) => `<th>${esc(k)}</th>`).join('') + '</tr>';
  const tbody = el('tbody');
  features.slice(0, 200).forEach((f, i) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tr = el('tr');
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      keyArr.map((k) => `<td title="${esc(p[k])}">${trunc(esc(String(p[k] ?? '')))}</td>`).join('');
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  return table;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function trunc(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 源坐标系选项：自动 + 三种显式声明 */
const SRC_AUTO = 'AUTO';
const SRC_OPTIONS = [
  { value: SRC_AUTO, label: '自动检测（不确定时按 WGS84 显示）' },
  { value: 'WGS84', label: 'WGS84 — GPS / OSM / 谷歌(国外)' },
  { value: 'GCJ02', label: 'GCJ-02 — 高德 / 腾讯 / 两步路 等国内数据' },
  { value: 'BD09', label: 'BD-09 — 百度' },
];

export const previewerTool: ToolModule = {
  id: 'previewer',
  title: '数据预览器',
  subtitle: '拖入文件并自动渲染地图与属性表',
  category: 'helper',
  usesMap: true,
  mount(host, svc) {
    clear(host);

    const mapHost = el('div', { className: 'gt-map' });
    const controller = new MapController();
    controller.init(mapHost, [35, 105], 4);
    controller.setPickEnabled(false);

    const tableHost = el('div');
    const info = el('div', { className: 'gt-output' });
    const coordHint = note('');

    let parsed: Parsed | null = null;

    const srcSel = select(SRC_OPTIONS, () => render(false), SRC_AUTO);

    /**
     * 解析源坐标系：显式选择则直接用；选「自动」时跑一次检测，
     * 检测能判定才采用，否则按 WGS84 显示并明确告知用户。
     */
    function resolveSourceSystem(): { system: CoordSystem; noteText: string } {
      const chosen = srcSel.value;
      if (chosen !== SRC_AUTO) {
        return {
          system: chosen as CoordSystem,
          noteText:
            chosen === 'GCJ02'
              ? '已按 GCJ-02 显示：数据将直接叠加在 GCJ-02 底图（高德）上，不再重复偏移。'
              : '已按所选坐标系换算后显示。',
        };
      }
      if (!parsed) return { system: 'WGS84', noteText: '' };
      const d = detectFromCoords(collectCoords(parsed.fc));
      if (d.likelySystem === 'UNKNOWN') {
        return {
          system: 'WGS84',
          noteText:
            '自动检测无法判定（内置参考锚点只覆盖 20 个城市地标，本数据不在其附近），已按 WGS84 显示。' +
            '若轨迹在国内地图上明显偏移，请在下方把「源坐标系」改为 GCJ-02，或用「坐标系检测器」做参考点校准。',
        };
      }
      return {
        system: d.likelySystem as CoordSystem,
        noteText: `自动检测判定为 ${d.likelySystem}（置信度约 ${Math.round(d.confidence * 100)}%）：${d.message}`,
      };
    }

    /**
     * 渲染当前数据。
     * @param fit 是否重新适配视野。切换源坐标系时不适配 —— 保持视野不动，
     *            才能直观看出数据相对底图平移了多少（判断坐标系对不对就看这个）。
     */
    function render(fit: boolean): void {
      if (!parsed) return;
      const { system, noteText } = resolveSourceSystem();
      controller.setData(parsed.fc, fit, system);
      coordHint.textContent = noteText;
    }

    const dz = createDropZone({
      accept:
        '.geojson,.json,.kml,.csv,.gpx,.wkt,.wkb,.gml,.xlsx,.xls,.zip,.shp,.dbf,.shx,.prj,.cpg,.topojson,.dxf,.osm',
      label: '拖入或点击选择文件',
      hint: 'GeoJSON / KML / GPX / CSV / Shapefile（整套文件可一起拖入，或打包成 .zip）',
      onFiles: async (files) => {
        try {
          parsed = await parseFilesToFeatureCollection(files);
          render(true);
          clear(info);
          info.appendChild(
            note(
              `${parsed.sourceType} · ${parsed.count} 个要素 · ${parsed.geometryTypes.join('/')} · 坐标 ${parsed.coordCount} · ` +
                `范围 [${parsed.bbox.map((n) => n.toFixed(4)).join(', ')}]`
            )
          );
          clear(tableHost);
          tableHost.appendChild(buildAttrTable(parsed.fc));
          svc.toast('已渲染预览', 'success');
        } catch (e) {
          parsed = null;
          clear(info);
          info.appendChild(note('解析失败：' + (e as Error).message));
          svc.toast('解析失败', 'error');
        }
      },
    });

    const baseSel = controller.createBasemapSelect();
    const layout = el('div', { className: 'gt-stack' });
    layout.append(
      dz,
      info,
      card('显示设置', [
        field('源坐标系', srcSel, 'KML / GeoJSON 规范上都是 WGS84；若是国内软件导出的 GCJ-02 数据，请在这里指明，否则会偏移约 500 m'),
        coordHint,
        field('底图', baseSel),
      ]),
      mapHost,
      card('属性表', [tableHost])
    );
    host.appendChild(layout);

    return () => controller.destroy();
  },
};
