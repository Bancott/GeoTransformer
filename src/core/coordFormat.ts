import proj4 from 'proj4';
import { toPoint, forward as mgrsForward } from 'mgrs';

/**
 * 坐标格式解析与格式化：DMS（度分秒）、度分、十进制、UTM、MGRS 互转。
 * 全部为纯函数，便于单元测试。坐标顺序与 GeoJSON 一致（lng 在前）。
 */

export type DmsDir = 'E' | 'W' | 'N' | 'S';

export interface ParsedCoordValue {
  value: number;
  dir: DmsDir | null;
}

/* ------------------------------ DMS / 度分 / 十进制 ------------------------------ */

/** 解析单个坐标值（度 / 度分 / 度分秒，可能带方向字母 E/W/N/S，或为十进制） */
export function parseCoordValue(raw: string): ParsedCoordValue | null {
  const s = raw.trim();
  if (!s) return null;
  // 剔除常见度分秒符号，替换为空格
  const norm = s.replace(/[°˚′´'″"]/g, ' ').replace(/[，,、]/g, ' ').replace(/\s+/g, ' ').trim();
  // 提取末尾方向字母
  let dir: DmsDir | null = null;
  const m = norm.match(/([NSEWnsew])\s*$/);
  if (m) {
    dir = m[1].toUpperCase() as DmsDir;
  }
  const bodyText = dir ? norm.slice(0, norm.lastIndexOf(dir)).trim() : norm;
  const parts = bodyText.split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  if (parts.length === 0) return null;

  let value: number;
  if (parts.length === 1) {
    value = parts[0];
  } else if (parts.length === 2) {
    value = parts[0] + parts[1] / 60; // 度分
  } else if (parts.length >= 3) {
    value = parts[0] + parts[1] / 60 + parts[2] / 3600; // 度分秒
  } else {
    return null;
  }
  return { value, dir };
}

/** 带方向的坐标值 -> 带符号十进制度（E/W 为经度，N/S 为纬度，S/W 取负） */
export function coordValueToDecimal(parsed: ParsedCoordValue): number {
  let v = parsed.value;
  const dir = parsed.dir;
  if (dir === 'W' || dir === 'S') v = -v;
  return v;
}

/** 两个坐标字符串 -> [lng, lat]（十进制度） */
export function parseCoordPair(lngText: string, latText: string): [number, number] | null {
  const lng = parseCoordValue(lngText);
  const lat = parseCoordValue(latText);
  if (!lng || !lat) return null;
  return [coordValueToDecimal(lng), coordValueToDecimal(lat)];
}

function toDmsPart(value: number): { d: number; m: number; s: number; dir: string } {
  const dir = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  return { d, m, s, dir };
}

/** 十进制 -> DMS 字符串，如 116°23′45.00″E */
export function decimalToDMS(value: number, isLat: boolean): string {
  const { d, m, s, dir } = toDmsPart(value);
  const dirChar = isLat ? (dir === '-' ? 'S' : 'N') : dir === '-' ? 'W' : 'E';
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toFixed(2).padStart(5, '0');
  return `${d}°${mStr}′${sStr}″${dirChar}`;
}

/** 十进制 -> 度分字符串，如 116°23.75′ */
export function decimalToDegreeMinute(value: number, isLat: boolean): string {
  const { d, ...rest } = toDmsPart(value);
  const abs = Math.abs(value);
  const minFloat = (abs - d) * 60;
  const dirChar = isLat ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${d}°${minFloat.toFixed(4)}′${dirChar}`;
  void rest;
}

/* ------------------------------ UTM ------------------------------ */

function utmProjCode(zone: number, south: boolean): string {
  const base = south ? 327 : 326;
  return `EPSG:${base}${String(zone).padStart(2, '0')}`;
}

function registerUtm(zone: number, south: boolean): void {
  const code = utmProjCode(zone, south);
  if (!proj4.defs(code)) {
    proj4.defs(
      code,
      `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs +type=crs`
    );
  }
}

export interface UtmResult {
  zone: number;
  south: boolean;
  easting: number;
  northing: number;
}

/** UTM 带号：世界标准，含挪威（32V）与斯瓦尔巴（31X/33X/35X/37X）特殊区 */
export function utmZone(lng: number, lat: number): { zone: number; south: boolean } {
  let zone = Math.floor((lng + 180) / 6) + 1;
  // 特殊区修正
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zone = 31;
    else if (lng >= 9 && lng < 21) zone = 33;
    else if (lng >= 21 && lng < 33) zone = 35;
    else if (lng >= 33 && lng < 42) zone = 37;
  }
  return { zone, south: lat < 0 };
}

/** WGS84 经纬度 -> UTM 投影坐标 */
export function wgs84ToUtm(lng: number, lat: number): UtmResult {
  const { zone, south } = utmZone(lng, lat);
  registerUtm(zone, south);
  const [easting, northing] = proj4('EPSG:4326', utmProjCode(zone, south), [lng, lat] as never) as [number, number];
  return { zone, south, easting, northing };
}

/** UTM 投影坐标 -> WGS84 经纬度 */
export function utmToWgs84(easting: number, northing: number, zone: number, south: boolean): [number, number] {
  registerUtm(zone, south);
  const [lng, lat] = proj4(utmProjCode(zone, south), 'EPSG:4326', [easting, northing] as never) as [number, number];
  return [lng, lat];
}

/** 解析 UTM 字符串，如 "50N 123456 789012" 或 "50S 500000 4325000" */
export function parseUtm(text: string): { easting: number; northing: number; zone: number; south: boolean } | null {
  const m = text.trim().match(/^(\d{1,2})\s*([NSns])\s+([\d.,]+)\s+([\d.,]+)/);
  if (!m) return null;
  const zone = Number(m[1]);
  const south = m[2].toUpperCase() === 'S';
  const easting = Number(m[3].replace(/[^\d.]/g, ''));
  const northing = Number(m[4].replace(/[^\d.]/g, ''));
  if (Number.isNaN(zone) || Number.isNaN(easting) || Number.isNaN(northing)) return null;
  return { easting, northing, zone, south };
}

/* ------------------------------ MGRS ------------------------------ */

/** WGS84 经纬度 -> MGRS 字符串 */
export function wgs84ToMgrs(lng: number, lat: number, accuracy = 5): string {
  return mgrsForward([lng, lat], accuracy);
}

/** MGRS 字符串 -> WGS84 经纬度（返回中心点） */
export function mgrsToWgs84(mgrs: string): [number, number] {
  const pt = toPoint(mgrs.trim().toUpperCase());
  return [pt[0], pt[1]];
}

/* ------------------------------ 通用自动识别 ------------------------------ */

/**
 * 从一行文本自动识别并解析出 [lng, lat]。
 * 支持：十进制 "116.39,39.90"、DMS "116°23'45\"E,39°54'27\"N"、
 *     度分 "116°23.75',39°54.5'"、UTM "50N 123456 789012"、MGRS "50SMK4796917670"。
 */
export function parseCoordLine(text: string): [number, number] | null {
  const t = text.trim();
  if (!t) return null;

  // MGRS：无逗号、纯字母数字
  if (/^[0-9]{1,2}[CDEFGHJKLMNPQRSTUVWX][A-Z]{2}[0-9]+$/i.test(t)) {
    try {
      return mgrsToWgs84(t);
    } catch {
      return null;
    }
  }

  // UTM：带 N/S 与两个坐标
  const utm = parseUtm(t);
  if (utm) {
    const [lng, lat] = utmToWgs84(utm.easting, utm.northing, utm.zone, utm.south);
    return [lng, lat];
  }

  const cleaned = t.replace(/[，]/g, ',');
  // 逗号分隔
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const lng = parseCoordValue(parts[0]);
      const lat = parseCoordValue(parts[1]);
      if (lng && lat) return [coordValueToDecimal(lng), coordValueToDecimal(lat)] as [number, number];
    }
    return null;
  }

  // 空格分隔：优先尝试两个十进制数
  const nums = t.split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length >= 2) return [nums[0], nums[1]] as [number, number];

  // 空格分隔 DMS：按方向字母切分
  const dm = t.match(/([\d°′'"\s.]+[EeWw])\s*([\d°′'"\s.]+[NnSs])/);
  if (dm) {
    const lng = parseCoordValue(dm[1]);
    const lat = parseCoordValue(dm[2]);
    if (lng && lat) return [coordValueToDecimal(lng), coordValueToDecimal(lat)] as [number, number];
  }
  return null;
}
