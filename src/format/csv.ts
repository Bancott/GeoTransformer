import type { FeatureCollection, Feature, Point } from 'geojson';

export interface CsvData {
  headers: string[];
  rows: string[][];
}

/** 极简但健壮的 CSV 解析：支持引号、换行、逗号分隔、制表符/分号嗅探 */
export function parseCsv(text: string, delimiter?: string): CsvData {
  const clean = text.replace(/^\uFEFF/, '');
  const delim = delimiter ?? sniffDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      if (field !== '' || row.length > 0 || rows.length === 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows: data };
}

function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] || '';
  let best = ',';
  let bestCount = 0;
  for (const d of [',', '\t', ';']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** 猜测经纬度列的下标 */
export function findLngLatColumns(headers: string[]) {
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/[_\s]/g, '');
  let lng = -1;
  let lat = -1;
  const lngKeys = ['lng', 'lon', 'long', 'longitude', 'x', '经度', '经', '东经', 'lonitude'];
  const latKeys = ['lat', 'latitude', 'y', '纬度', '纬', '北纬'];

  headers.forEach((h, i) => {
    const n = norm(h);
    if (lng === -1 && lngKeys.includes(n)) lng = i;
    if (lat === -1 && latKeys.includes(n)) lat = i;
  });

  // 若 bbox 就是 x/y 的 geojson 需要判断方向
  return { lngIndex: lng, latIndex: lat };
}

export interface CsvPointOptions {
  /** 坐标顺序换位：当 lng/lat 检测相反时使用 */
  swap?: boolean;
  /** 明确指定经度列名 */
  lngColumn?: string;
  /** 明确指定纬度列名 */
  latColumn?: string;
}

/** CSV（含经纬度列）→ Point GeoJSON */
export function csvToGeoJSON(text: string, options: CsvPointOptions = {}): FeatureCollection {
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) throw new Error('CSV 为空');

  let lngIndex = -1;
  let latIndex = -1;
  if (options.lngColumn || options.latColumn) {
    headers.forEach((h, i) => {
      if (options.lngColumn && h.trim().toLowerCase() === options.lngColumn!.toLowerCase()) lngIndex = i;
      if (options.latColumn && h.trim().toLowerCase() === options.latColumn!.toLowerCase()) latIndex = i;
    });
  } else {
    const guess = findLngLatColumns(headers);
    lngIndex = guess.lngIndex;
    latIndex = guess.latIndex;
  }
  if (lngIndex === -1 || latIndex === -1) {
    throw new Error(
      '未找到经度/纬度列。请确保 CSV 包含如 lng/lon/longitude/经度 与 lat/latitude/纬度 的列。'
    );
  }

  const features: Feature<Point>[] = [];
  rows.forEach((r, idx) => {
    const lng = Number(r[lngIndex]);
    const lat = Number(r[latIndex]);
    if (Number.isNaN(lng) || Number.isNaN(lat)) return;
    const props: Record<string, unknown> = { __row: idx };
    headers.forEach((h, i) => {
      if (i === lngIndex || i === latIndex) return;
      props[h] = r[i];
    });
    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'Point',
        coordinates: options.swap ? [lat, lng] : [lng, lat],
      },
    });
  });

  return { type: 'FeatureCollection', features };
}
