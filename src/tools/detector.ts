import type { FeatureCollection } from 'geojson';
import { el, clear } from '@/ui/dom';
import { select, field, button, card, note } from '@/ui/form';
import { detectFromCoords, collectCoords, classifyByReference } from '@/core/detect';
import { MapController } from '@/map/mapController';
import { parseFilesToFeatureCollection } from '@/tools/fileParsers';
import { createDropZone } from '@/ui/dropzone';
import type { CoordSystem } from '@/core/types';
import type { ToolModule } from '@/toolRegistry';

/** 检测结果对应的徽章样式类（定义于 styles/main.css，使用 --sys-* token） */
const SYSTEM_BADGE_CLASS: Record<string, string> = {
  WGS84: 'gt-detector-badge--wgs84',
  GCJ02: 'gt-detector-badge--gcj02',
  BD09: 'gt-detector-badge--bd09',
};

function buildPointFC(coords: [number, number][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map((c, i) => ({
      type: 'Feature',
      properties: { idx: i },
      geometry: { type: 'Point', coordinates: c },
    })),
  };
}

export const detectorTool: ToolModule = {
  id: 'detector',
  title: '坐标系检测器',
  subtitle: '判断数据是 WGS-84、GCJ-02 还是 BD-09',
  category: 'helper',
  usesMap: true,
  mount(host, svc) {
    clear(host);

    const mapHost = el('div', { className: 'gt-map gt-map--sm' });
    const controller = new MapController();
    controller.init(mapHost, [35, 105], 4);
    controller.setPickEnabled(false);

    const result = el('div', { className: 'gt-output' });
    let fc: FeatureCollection | null = null;
    /** 最近一次参与检测的坐标，用于参考点校准 */
    let lastCoords: [number, number][] = [];

    /* ---------------- 假定坐标系：把数据按某个假设画到地图上 ---------------- */
    const assumpSel = select(
      [
        { value: 'WGS84', label: 'WGS84' },
        { value: 'GCJ02', label: 'GCJ-02' },
        { value: 'BD09', label: 'BD-09' },
      ],
      () => renderAssumption(),
      'WGS84'
    );

    /** 按当前「假定坐标系」重绘地图：假设正确时轨迹会贴合底图上的道路/地物 */
    function renderAssumption(): void {
      const sys = assumpSel.value as CoordSystem;
      if (fc) controller.setData(fc, true, sys);
      else if (lastCoords.length) controller.setData(buildPointFC(lastCoords), true, sys);
    }

    /* --------------------------- 参考点校准 --------------------------- */
    const refInfo = el('div', { className: 'gt-output' });
    let calibrating = false;

    const calibBtn = button('开始校准（在地图上点击地物真实位置）', () => {
      calibrating = !calibrating;
      controller.setPickEnabled(calibrating);
      calibBtn.textContent = calibrating ? '取消校准' : '开始校准（在地图上点击地物真实位置）';
      clear(refInfo);
      if (calibrating) {
        refInfo.appendChild(
          note(
            '请在**轨迹上的某个明显地物**（路口、桥头、停车场入口等）处，点击底图上该地物的**真实位置**。' +
              '建议先切到 WGS-84 底图（OSM / Esri）以提高判读精度。'
          )
        );
        svc.toast('已进入校准模式：点击地物真实位置', 'info', 5000);
      }
    }, 'ghost');

    controller.setPickHandler((e) => {
      if (!calibrating) return;
      const coords = lastCoords.length ? lastCoords : fc ? collectCoords(fc) : [];
      if (coords.length === 0) {
        svc.toast('请先加载数据或粘贴坐标', 'warning');
        return;
      }
      const ref: [number, number] = [e.lng, e.lat];
      const m = classifyByReference(coords, ref);
      clear(refInfo);
      if (!m) {
        refInfo.appendChild(note('没有可用坐标，无法校准。'));
        return;
      }
      const rows: Array<[CoordSystem, string]> = ['WGS84', 'GCJ02', 'BD09'].map((s) => [
        s as CoordSystem,
        `${m.distances[s as CoordSystem].toFixed(1)} m`,
      ]);
      const tbl = el('table', { className: 'gt-table' });
      tbl.innerHTML =
        '<thead><tr><th>假设坐标系</th><th>离参考点最近的距离</th></tr></thead><tbody>' +
        rows
          .map(
            ([s, dist]) =>
              `<tr${m.reliable && s === m.best ? ' style="font-weight:700"' : ''}>` +
              `<td>${s}${m.reliable && s === m.best ? ' ✅' : ''}</td><td>${dist}</td></tr>`
          )
          .join('') +
        '</tbody>';
      refInfo.append(
        note(
          `参考点（WGS84）：${ref[0].toFixed(6)}, ${ref[1].toFixed(6)}　最近样本：` +
            `${m.sample[0].toFixed(6)}, ${m.sample[1].toFixed(6)}`
        ),
        note(
          m.reliable
            ? `判定结果：**${m.best}** —— 该假设下最近样本距参考点仅 ${m.distances[m.best].toFixed(1)} m，` +
                `与次佳相差 ${m.marginMeters.toFixed(1)} m。`
            : `参考点不可信：三种假设下最近样本距参考点都在 ${m.distances[m.best].toFixed(0)} m 以上，` +
                `说明点击处并未落在数据上（或点偏了）。请放大到街道级，点击轨迹经过的明显地物（路口、桥头等）后重试。`
        ),
        tbl
      );
      if (m.reliable) {
        assumpSel.value = m.best;
        renderAssumption();
      }
      calibrating = false;
      controller.setPickEnabled(false);
      calibBtn.textContent = '开始校准（在地图上点击地物真实位置）';
      svc.toast(m.reliable ? `校准结果：${m.best}` : '参考点不在数据上，请重新点击', m.reliable ? 'success' : 'warning', 5000);
    });

    const dz = createDropZone({
      accept:
        '.geojson,.json,.kml,.csv,.gpx,.wkt,.wkb,.zip,.shp,.dbf,.shx,.prj,.cpg,.gml,.xlsx,.xls,.dxf,.osm,.topojson',
      label: '拖入或点击选择文件（GeoJSON / KML / CSV / Shapefile）',
      hint: '将从中提取坐标进行检测；Shapefile 整套文件可一起拖入',
      onFiles: async (files) => {
        try {
          const parsed = await parseFilesToFeatureCollection(files);
          fc = parsed.fc;
          controller.setData(fc, true, assumpSel.value as CoordSystem);
          lastCoords = collectCoords(fc).map((c) => [c[0], c[1]] as [number, number]);
          result.innerHTML = '';
          result.appendChild(note(`已加载 ${parsed.fileName}：${parsed.count} 个要素。点击“开始检测”。`));
          svc.toast('文件已加载', 'success');
        } catch (e) {
          fc = null;
          result.innerHTML = '';
          result.appendChild(note('解析失败：' + (e as Error).message));
          svc.toast('解析失败', 'error', 8000);
        }
      },
    });

    const txtInput = el('textarea', {
      className: 'gt-input gt-textarea',
      attrs: { rows: '6', placeholder: '或粘贴坐标，每行一组：lng,lat' },
    });

    const runBtn = button('开始检测', () => {
      let coords: [number, number][];
      if (fc) {
        coords = collectCoords(fc).map((c) => [c[0], c[1]] as [number, number]);
      } else {
        const lines = txtInput.value.split(/\r?\n/);
        coords = lines
          .map((l) => l.trim().split(/[\s,，;；]+/).map(Number))
          .filter((n) => n.length >= 2 && !Number.isNaN(n[0]) && !Number.isNaN(n[1]))
          .map((n) => [n[0], n[1]]);
      }
      // 若粘贴了坐标，也在图上展示
      if (!fc && coords.length) controller.setData(buildPointFC(coords), true);

      if (coords.length === 0) {
        svc.toast('没有可检测的坐标', 'warning');
        return;
      }
      const d = detectFromCoords(coords);
      clear(result);
      lastCoords = coords;
      // 自动检测有结论时，把地图上的「假定坐标系」也切过去，便于肉眼复核
      if (d.likelySystem !== 'UNKNOWN') {
        assumpSel.value = d.likelySystem;
        renderAssumption();
      }
      // 徽章配色由 CSS token 提供，深浅主题各有一套
      const badge = el('span', {
        className: `gt-detector-badge ${SYSTEM_BADGE_CLASS[d.likelySystem] ?? 'gt-detector-badge--unknown'}`,
        text: d.likelySystem === 'UNKNOWN' ? '无法判定' : d.likelySystem,
      });
      const conf = el('div', { className: 'gt-detector-conf' });
      conf.innerHTML = `置信度 <b>${Math.round(d.confidence * 100)}%</b>` +
        `<span class="gt-bar"><span class="gt-bar__fill" style="width:${Math.round(d.confidence * 100)}%"></span></span>`;
      result.append(
        el('div', { className: 'gt-detector' }, badge, conf),
        note(d.message),
        note(`样本范围：中国境内占比 ${Math.round(d.insideChinaRatio * 100)}%`)
      );

      if (d.samples.length) {
        const tbl = el('table', { className: 'gt-table' });
        tbl.innerHTML =
          '<thead><tr><th>坐标</th><th>最近锚点</th><th>判定</th></tr></thead><tbody>' +
          d.samples
            .map(
              (s) =>
                `<tr><td>${s.coord[0].toFixed(6)},${s.coord[1].toFixed(6)}</td><td>${s.anchorName}</td><td>${s.verdict}</td></tr>`
            )
            .join('') +
          '</tbody>';
        result.appendChild(tbl);
      }
    });

    const modeSel = select(
      [
        { value: 'file', label: '上传文件' },
        { value: 'paste', label: '粘贴坐标' },
      ],
      (m) => {
        dz.style.display = m === 'file' ? '' : 'none';
        txtInput.style.display = m === 'paste' ? '' : 'none';
      },
      'file'
    );

    const baseSel = controller.createBasemapSelect();
    const layout = el('div', { className: 'gt-stack' });
    layout.append(
      card('数据来源', [modeSel, dz, txtInput]),
      runBtn,
      card('检测结果', [
        result,
        note(
          '自动检测依赖内置的 20 个城市地标锚点，数据不在其附近时无法判定（坐标本身不含判据）；' +
            '此时请用下面的对照方法确认。'
        ),
      ]),
      card('对照确认（可靠）', [
        field('假定坐标系', assumpSel, '在高德（GCJ-02）底图上选对坐标系时轨迹会贴合道路；在 OSM（WGS-84）底图同理'),
        note(
          '方法一（肉眼对照）：切换「假定坐标系」与底图，轨迹贴合道路/地物的那一组即为正确答案。'
        ),
        note(
          '方法二（参考点校准）：点击下方按钮后，在轨迹的某个明显地物处点击底图上该地物的真实位置，' +
            '工具会比较三种假设与该参考点的距离并给出结论 —— 任何数据都适用。'
        ),
        calibBtn,
        refInfo,
      ]),
      field('底图', baseSel),
      mapHost
    );
    host.appendChild(layout);

    return () => controller.destroy();
  },
};
