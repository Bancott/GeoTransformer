import { el, clear } from '@/ui/dom';
import { createDropZone } from '@/ui/dropzone';
import { parseToFeatureCollection, type Parsed } from '@/tools/fileParsers';
import { field, select, button, card, note } from '@/ui/form';
import type { ToolModule } from '@/toolRegistry';
import { TARGETS, writeTarget, type TargetType } from '@/tools/outputTargets';

function statsText(p: Parsed): string {
  const bbox = p.bbox.map((n) => Number(n.toFixed(5))).join(',');
  return `${p.sourceType} · ${p.count} 个要素 · ${p.geometryTypes.join(' / ') || '—'} · 坐标 ${p.coordCount} · 范围 [${bbox}]`;
}

function sourceInfo(p: Parsed): HTMLElement {
  const row = el('div', { className: 'gt-fileinfo' });
  const name = el('div', { className: 'gt-fileinfo__name', text: p.fileName });
  const meta = el('div', {
    className: 'gt-fileinfo__meta',
    text: `${statsText(p)} · 大小 ${(p.size / 1024).toFixed(1)} KB`,
  });
  row.append(name, meta);
  return row;
}

export const formatConvertTool: ToolModule = {
  id: 'format-convert',
  title: '格式转换',
  subtitle: 'GeoJSON ↔ Shapefile / KML / TopoJSON / WKT / WKB / GPX / GML / DXF / OSM / CSV / Excel',
  category: 'format',
  mount(host, svc) {
    clear(host);
    let parsed: Parsed | null = null;

    const fileInfo = el('div', { className: 'gt-output' });
    const targetSel = select(
      TARGETS,
      () => undefined,
      'GeoJSON'
    );

    const convertBtn = button('转换并下载', () => {
      if (!parsed) {
        svc.toast('请先上传源文件', 'warning');
        return;
      }
      const target = targetSel.value as TargetType;
      convertBtn.disabled = true;
      convertBtn.textContent = '转换中…';
      writeTarget(parsed, target, svc)
        .then(() => svc.toast('转换完成，已开始下载', 'success'))
        .catch((e) => svc.toast('转换失败：' + (e as Error).message, 'error'))
        .finally(() => {
          convertBtn.disabled = false;
          convertBtn.textContent = '转换并下载';
        });
    });

    const dropzone = createDropZone({
      accept: '.geojson,.json,.kml,.csv,.zip,.wkt,.wkb,.gpx,.gml,.dxf,.osm,.xlsx,.xls,.topojson',
      label: '拖入或点击选择文件',
      hint: 'GeoJSON / Shapefile / KML / CSV / TopoJSON / WKT / WKB / GPX / GML / DXF / OSM XML / Excel / PostGIS dump',
      onFile: async (file) => {
        try {
          parsed = await parseToFeatureCollection(file);
          clear(fileInfo);
          fileInfo.appendChild(sourceInfo(parsed));
          svc.toast(`已识别为 ${parsed.sourceType}：${parsed.count} 个要素`, 'success');
        } catch (e) {
          parsed = null;
          clear(fileInfo);
          fileInfo.appendChild(
            note('解析失败：' + (e as Error).message)
          );
          svc.toast('文件解析失败', 'error');
        }
      },
    });

    const left = card('① 源文件', [dropzone, fileInfo]);
    const right = card('② 输出', [
      field('目标格式', targetSel),
      note('任意源格式会先解析为内部 GeoJSON，再输出为目标格式。'),
      convertBtn,
    ]);

    const grid = el('div', { className: 'gt-grid' });
    grid.append(left, right);
    host.appendChild(grid);
  },
};
