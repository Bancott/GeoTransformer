import type { FeatureCollection } from 'geojson';
import type { CoordShift } from '@/core/types';
import type { AppServices } from '@/toolRegistry';
import { el, clear } from '@/ui/dom';
import { select, field, button, card, note, fillSelect } from '@/ui/form';
import { createDropZone } from '@/ui/dropzone';
import { dropZ, hasZ } from '@/core/coordBounds';
import { parseFilesToFeatureCollection, type Parsed } from '@/tools/fileParsers';
import {
  TARGETS,
  writeTarget,
  targetLabel,
  sourceTargetOf,
  requiresLngLat,
  DEGREE_ONLY_TARGETS,
  type TargetType,
} from '@/tools/outputTargets';
import { convertKmlText } from '@/format/kml';
import { convertGpxText } from '@/format/gpx';

/**
 * 「坐标转换 · 文件模式」的可复用卡片。
 *
 * 两个坐标类工具（坐标投影转换 / 投影坐标转换）共用同一份实现，保证行为一致：
 * - 输出格式**默认跟随源文件**，也可另选其它格式（清单与「格式转换」共用）；
 * - 源与目标同为地理坐标系时，KML / GPX 走**就地改写**，完整保留
 *   `gx:Track` / `<when>` / `<Style>` / `<ele>` / `<time>` 等结构；
 * - 目标为投影坐标系时，自动隐藏 KML / GPX / OSM（这三种格式只能表示经纬度），
 *   避免产出无法使用的文件。
 */

/** 下拉框里代表「与源文件格式相同」的哨兵值 */
const SOURCE_TARGET = '__SOURCE__';

export interface CoordFileCardConfig {
  /** 坐标转换：返回「源 CRS → 目标 CRS」的要素集合转换函数 */
  transform: () => (fc: FeatureCollection) => FeatureCollection;
  /**
   * 就地改写用的一元坐标偏移。
   * 返回 null 表示当前配置不支持（例如源或目标是投影坐标系，KML/GPX 无法表达）。
   */
  inPlaceShift: () => CoordShift | null;
  /** 目标坐标系是否为经纬度（度）；为 false 时禁用 KML / GPX / OSM */
  targetIsGeographic: () => boolean;
  /** 上传区接受的文件类型 */
  accept?: string;
  /** 上传区下方提示 */
  hint?: string;
}

export interface CoordFileCard {
  element: HTMLElement;
  /** 源 / 目标坐标系变化后调用，用于刷新可选输出格式 */
  refresh: () => void;
}

const DEFAULT_ACCEPT =
  '.geojson,.json,.kml,.csv,.gpx,.wkt,.wkb,.gml,.xlsx,.xls,.zip,.shp,.dbf,.shx,.prj,.cpg,.topojson,.dxf,.osm';
const DEFAULT_HINT =
  'GeoJSON / KML / GPX / WKT / WKB / GML / CSV / Excel / Shapefile（整套文件可一起拖入，或打包成 .zip）';

export function createCoordFileCard(
  svc: AppServices,
  config: CoordFileCardConfig
): CoordFileCard {
  let parsed: Parsed | null = null;

  const fileInfo = el('div');
  const targetSel = select([], () => undefined);
  const targetHint = note('上传文件后，默认保持源文件格式输出。');
  // 带高程的坐标会被 QGIS 等软件判定为三维（EPSG:4979），需要时在此去掉
  const zSel = select(
    [
      { value: 'keep', label: '保留高程（原样输出）' },
      { value: 'drop', label: '丢弃高程（输出二维）' },
    ],
    () => undefined,
    'keep'
  );
  const convertBtn = button('转换并下载', () => run(), 'primary');

  const dropAltitude = (): boolean => zSel.value === 'drop';

  /** 根据当前源格式与目标坐标系，重建可选格式 */
  function refresh(): void {
    const geographic = config.targetIsGeographic();
    const src = parsed ? sourceTargetOf(parsed.sourceType) : null;
    // 源格式自身若是「只能经纬度」的格式，目标为投影坐标系时也不能选它
    const sourceAllowed = src !== null && (!requiresLngLat(src) || geographic);
    const targets = geographic
      ? TARGETS
      : TARGETS.filter((t) => !DEGREE_ONLY_TARGETS.includes(t.value));
    const options = [
      ...(sourceAllowed && src ? [{ value: SOURCE_TARGET, label: `与源文件相同 — ${targetLabel(src)}` }] : []),
      ...targets,
    ];
    fillSelect(targetSel, options, sourceAllowed ? SOURCE_TARGET : 'GeoJSON');

    if (!src) {
      targetHint.textContent = '上传文件后，默认保持源文件格式输出。';
      return;
    }
    if (!geographic) {
      // 投影坐标系下提醒：GeoJSON 等格式不记录坐标系
      targetHint.textContent =
        '目标为投影坐标系（单位通常为米），KML / GPX / OSM 只能表示经纬度，已从列表中移除；' +
        '需要这三种格式请先把目标改为地理坐标系（如 EPSG:4326）。' +
        '另外 GeoJSON / CSV 等格式本身不记录坐标系，导入 QGIS 等软件后需手动指定为该投影坐标系。';
      return;
    }
    const zNote = parsed && hasZ(parsed.fc) ? '（当前数据含高程，可在此选择丢弃以输出二维）' : '';
    targetHint.textContent = `识别为 ${parsed?.sourceType}，默认按 ${targetLabel(src!)} 输出；可另选其它格式。${zNote}`;
  }

  /** 同格式的 KML / GPX 走就地改写，保住文档结构 */
  function writeInPlace(source: Parsed, target: TargetType): boolean {
    if (!source.rawText) return false;
    const shift = config.inPlaceShift();
    if (!shift) return false;
    const base = source.fileName.replace(/\.[^.]+$/, '') || 'converted';
    const opts = { dropAltitude: dropAltitude() };
    try {
      if (target === 'KML' && source.sourceType === 'KML') {
        svc.downloadText(
          convertKmlText(source.rawText, shift, opts),
          `${base}_converted.kml`,
          'application/vnd.google-earth.kml+xml'
        );
        return true;
      }
      if (target === 'GPX' && source.sourceType === 'GPX') {
        svc.downloadText(
          convertGpxText(source.rawText, shift, opts),
          `${base}_converted.gpx`,
          'application/gpx+xml'
        );
        return true;
      }
    } catch (e) {
      svc.toast('保留原文件结构失败（' + (e as Error).message + '），改用重写方式输出', 'warning', 6000);
    }
    return false;
  }

  async function run(): Promise<void> {
    if (!parsed) {
      svc.toast('请先上传文件', 'warning');
      return;
    }
    const source = parsed;
    const chosen = targetSel.value;
    const target = chosen === SOURCE_TARGET ? sourceTargetOf(source.sourceType) : (chosen as TargetType);

    convertBtn.disabled = true;
    convertBtn.textContent = '转换中…';
    try {
      if (chosen === SOURCE_TARGET && (target === 'KML' || target === 'GPX') && writeInPlace(source, target)) {
        svc.toast(`转换完成，已下载 ${targetLabel(target)} 文件`, 'success');
        return;
      }
      const transformed = config.transform()(source.fc);
      const out = dropAltitude() ? dropZ(transformed) : transformed;
      await writeTarget({ ...source, fc: out }, target, svc);
      const zNote = dropAltitude() ? '（已丢弃高程）' : '';
      svc.toast(`转换完成，已下载 ${targetLabel(target)} 文件${zNote}`, 'success');
    } catch (e) {
      svc.toast('转换失败：' + (e as Error).message, 'error', 8000);
    } finally {
      convertBtn.disabled = false;
      convertBtn.textContent = '转换并下载';
    }
  }

  const dz = createDropZone({
    accept: config.accept ?? DEFAULT_ACCEPT,
    label: '拖入或点击选择文件',
    hint: config.hint ?? DEFAULT_HINT,
    onFiles: async (files) => {
      try {
        parsed = await parseFilesToFeatureCollection(files);
        clear(fileInfo);
        fileInfo.appendChild(
          note(`已加载 ${parsed.fileName}：${parsed.count} 个要素，${parsed.geometryTypes.join('/')}`)
        );
        refresh();
        svc.toast('文件已加载，点击“转换并下载”', 'success');
      } catch (e) {
        parsed = null;
        clear(fileInfo);
        fileInfo.appendChild(note('解析失败：' + (e as Error).message));
        refresh();
        svc.toast('文件解析失败', 'error', 8000);
      }
    },
  });

  const element = card('文件转换', [
    dz,
    fileInfo,
    field('输出格式', targetSel),
    field('高程（Z 值）', zSel, '带高程的数据在 QGIS 等软件中会显示为三维（EPSG:4979），需要二维时选择丢弃'),
    targetHint,
    convertBtn,
  ]);

  refresh();
  return { element, refresh };
}
