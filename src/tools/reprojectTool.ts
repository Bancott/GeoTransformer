import { el, clear } from '@/ui/dom';
import { select, field, button, card, note, textInput, type SelectOption } from '@/ui/form';
import { PROJECTIONS } from '@/core/types';
import type { CoordShift } from '@/core/types';
import {
  reprojectFeatureCollection,
  reprojectCoord,
  projectionKind,
  assertPlausibleReproject,
  suggestGaussKrugerVariant,
  GEO_CODE_GCJ,
  GEO_CODE_BD09,
  MERC_CODE_GCJ,
  MERC_CODE_BD09,
} from '@/core/reproject';
import { createCoordFileCard } from '@/tools/coordFileCard';
import type { ToolModule } from '@/toolRegistry';

/**
 * 坐标系下拉：按「是否米制」分组，避免在经纬度与投影之间选错。
 * 分组优先取定义自带的 group（如 CGCS2000 分带系列），其余由 `projectionKind()` 推导，
 * 新增 EPSG 定义时会自动落到正确分组。
 */
const GEO_GROUP = '地理坐标系（经纬度）';
const PROJ_GROUP = '投影坐标系（单位：米）';

const CRS_OPTIONS: SelectOption[] = [
  ...PROJECTIONS.map((p) => ({
    value: p.code,
    label: `${p.code} · ${p.name}`,
    group: p.group ?? (projectionKind(p.code) === 'geographic' ? GEO_GROUP : PROJ_GROUP),
  })),
  // 中国偏移坐标系（无 EPSG 编号，用内置伪代码）
  { value: GEO_CODE_GCJ, label: `${GEO_CODE_GCJ} · 火星坐标（GCJ-02 经纬度）`, group: GEO_GROUP },
  { value: GEO_CODE_BD09, label: `${GEO_CODE_BD09} · 百度坐标（BD-09 经纬度）`, group: GEO_GROUP },
  { value: MERC_CODE_GCJ, label: `${MERC_CODE_GCJ} · 火星墨卡托（GCJ-02 投影，米）— 与高德瓦片同投影`, group: PROJ_GROUP },
  { value: MERC_CODE_BD09, label: `${MERC_CODE_BD09} · 百度墨卡托（BD-09 投影，米）`, group: PROJ_GROUP },
  { value: 'CUSTOM', label: '自定义投影…', group: '自定义' },
];

function crsSelect(onChange?: (v: string) => void): HTMLSelectElement {
  const sel = select(CRS_OPTIONS, (v) => onChange?.(v), 'EPSG:4326');
  return sel;
}

function resolveCode(sel: HTMLSelectElement, custom: HTMLInputElement): string {
  if (sel.value === 'CUSTOM') {
    const v = custom.value.trim();
    if (!v) throw new Error('请填写自定义投影字符串或 EPSG 代码');
    return v;
  }
  return sel.value;
}

export const reprojectTool: ToolModule = {
  id: 'reproject',
  title: '投影坐标转换',
  subtitle: '地理坐标系 ↔ 投影坐标系（如 EPSG:3857 ↔ EPSG:4326）',
  category: 'coord',
  mount(host, svc) {
    clear(host);

    const fromSel = crsSelect(() => onModeChange());
    const fromCustom = textInput('自定义：EPSG:3857 或 +proj=mert…（完整 proj4 字符串）');
    const toSel = crsSelect(() => onModeChange());
    const toCustom = textInput('自定义：目标投影定义');

    /** 文件卡片创建后回填；用于源/目标变化时刷新可选输出格式 */
    let refreshFileCard: () => void = () => undefined;

    function onModeChange(): void {
      fromCustom.disabled = fromSel.value !== 'CUSTOM';
      toCustom.disabled = toSel.value !== 'CUSTOM';
      // 目标是否为地理坐标系会影响可选的输出格式（KML/GPX/OSM 只接受经纬度）
      refreshFileCard();
    }

    /** 当前源 / 目标代码；无效时抛出带提示的错误 */
    function currentCodes(): { from: string; to: string } {
      return { from: resolveCode(fromSel, fromCustom), to: resolveCode(toSel, toCustom) };
    }

    /** 目标坐标系是否为经纬度（度） */
    function targetIsGeographic(): boolean {
      try {
        return projectionKind(currentCodes().to) === 'geographic';
      } catch {
        return true;
      }
    }

    /**
     * 就地改写用的一元偏移。
     * 仅当源与目标**都是地理坐标系**时才可用：KML / GPX 的坐标规范只允许经纬度，
     * 任何一端是投影坐标系（米）都无法用就地改写表达。
     */
    function inPlaceShift(): CoordShift | null {
      try {
        const { from, to } = currentCodes();
        if (projectionKind(from) !== 'geographic' || projectionKind(to) !== 'geographic') return null;
        return (lng, lat) => {
          const [x, y] = reprojectCoord([lng, lat], from, to);
          return [x, y];
        };
      } catch {
        return null;
      }
    }

    const fileCard = createCoordFileCard(svc, {
      transform: () => (fc) => {
        const { from, to } = currentCodes();
        // 分带编码预检：带号前缀选错会得到完全错误的结果，先给出明确提示
        const hint = suggestGaussKrugerVariant(fc, from);
        if (hint) throw new Error(hint);
        const out = reprojectFeatureCollection(fc, from, to);
        // 结果明显越界时同样是源坐标系选错 —— 直接报错而不是产出错误文件
        assertPlausibleReproject(out, to);
        return out;
      },
      inPlaceShift,
      targetIsGeographic,
      accept:
        '.geojson,.json,.kml,.csv,.gpx,.wkt,.wkb,.gml,.xlsx,.xls,.zip,.shp,.dbf,.shx,.prj,.cpg,.topojson,.dxf,.osm',
      hint: 'GeoJSON / KML / GPX / WKT / WKB / GML / CSV / Excel / Shapefile（整套文件可一起拖入，或打包成 .zip）',
    });
    refreshFileCard = fileCard.refresh;

    // 单点示例转换（随手验证）
    const sampleLng = textInput('116.391');
    const sampleLat = textInput('39.907');
    const sampleBtn = button('示例：单点转换', () => {
      const lng = Number(sampleLng.value);
      const lat = Number(sampleLat.value);
      if (Number.isNaN(lng) || Number.isNaN(lat)) {
        svc.toast('请输入坐标', 'warning');
        return;
      }
      let from: string;
      let to: string;
      try {
        from = resolveCode(fromSel, fromCustom);
        to = resolveCode(toSel, toCustom);
      } catch (e) {
        svc.toast((e as Error).message, 'warning');
        return;
      }
      try {
        const out = reprojectFeatureCollection(
          {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
          },
          from,
          to
        );
        const coords = (out.features[0].geometry as { coordinates: number[] }).coordinates;
        svc.toast(`结果：${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`, 'info', 4000);
      } catch (e) {
        svc.toast('转换失败：' + (e as Error).message, 'error');
      }
    }, 'ghost');

    const grid = el('div', { className: 'gt-grid' });
    grid.append(
      card('源投影', [
        field('EPSG', fromSel),
        field('自定义', fromCustom),
      ]),
      card('目标投影', [
        field('EPSG', toSel),
        field('自定义', toCustom),
      ])
    );

    const sampleCard = card('单点示例', [
      el('div', { className: 'gt-inline' }, field('经度', sampleLng), field('纬度', sampleLat)),
      sampleBtn,
      note('注：坐标顺序与 GeoJSON 一致（经度在前）。自定义投影请填写 proj4 字符串或 proj4 已内置的 EPSG 代码。'),
    ]);

    const stack = el('div', { className: 'gt-stack' });
    stack.append(grid, fileCard.element, sampleCard);
    host.appendChild(stack);
    onModeChange();
  },
};
