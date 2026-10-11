import * as XLSX from 'xlsx';
import type { FeatureCollection, Feature, Point } from 'geojson';
import { findLngLatColumns } from './csv';

/**
 * Excel（.xlsx，含坐标列）-> GeoJSON。
 * 读取第一个工作表，浏览器端解析，数据不出本地。
 */

function toStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** 从 xlsx 文件 Buffer 解析为 Point GeoJSON（自动识别经度/纬度列） */
export async function excelToGeoJSON(buffer: ArrayBuffer): Promise<FeatureCollection> {
  const wb = XLSX.read(buffer, { type: 'array' });
  const name = wb.SheetNames[0];
  if (!name) throw new Error('xlsx 中没有工作表');
  const sheet = wb.Sheets[name];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true }) as unknown[][];
  if (rawRows.length === 0) throw new Error('xlsx 内容为空');

  const headers = rawRows[0].map((h, i) => toStr(h).trim() || 'col' + (i + 1));
  const { lngIndex, latIndex } = findLngLatColumns(headers);
  if (lngIndex === -1 || latIndex === -1) {
    throw new Error('未找到经度/纬度列。请确保包含如 经度/lon/lng 与 纬度/lat 的列。');
  }

  const features: Feature<Point>[] = [];
  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const lng = Number(row[lngIndex]);
    const lat = Number(row[latIndex]);
    if (Number.isNaN(lng) || Number.isNaN(lat)) continue;
    const props: Record<string, unknown> = { __row: r - 1 };
    headers.forEach((h, i) => {
      if (i === lngIndex || i === latIndex) return;
      props[h] = toStr(row[i]) === '' ? null : row[i];
    });
    features.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
  }
  if (features.length === 0) throw new Error('没有解析到带有效坐标的行');
  return { type: 'FeatureCollection', features };
}
