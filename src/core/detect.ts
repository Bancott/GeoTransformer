import type { Position } from 'geojson';
import {
  outOfChina,
  wgs84ToGcj02,
  wgs84ToBd09,
  convertCoord,
} from '@/core/coordTransform';
import type { CoordSystem } from '@/core/types';

/**
 * 坐标系检测（WGS84 / GCJ-02 / BD-09）。
 *
 * 前提：GCJ-02 / BD-09 只在中国大陆范围内对坐标施加一个**平滑偏移**（约 500 m），
 * 因此**单凭坐标值本身无法判定**属于哪一套 —— 必须借助外部参照。本模块提供两种参照方式：
 *
 * 1. `detectFromCoords()` —— 内置城市地标锚点表。只有当样本落在某个锚点附近时才有判定，
 *    覆盖范围有限（一份任意轨迹大概率不在这些地标旁），此时返回 UNKNOWN 并说明原因；
 * 2. `classifyByReference()` —— 由用户指定一个**参考点**（在地图上点击某个地物的真实
 *    WGS84 位置），比较三种假设下与参考点的距离。任何数据都能用，判据清晰，
 *    因为三种假设的间距（约 500 m）远大于人工点击误差（约 20 m）。
 */

interface Anchor {
  name: string;
  wgs84: [number, number];
}

const ANCHORS: Anchor[] = [
  { name: '北京·天安门', wgs84: [116.39128, 39.90752] },
  { name: '上海·人民广场', wgs84: [121.47332, 31.23042] },
  { name: '广州·海珠广场', wgs84: [113.27436, 23.10909] },
  { name: '深圳·市民中心', wgs84: [114.05693, 22.54724] },
  { name: '成都·天府广场', wgs84: [104.06574, 30.65987] },
  { name: '成都·春熙路', wgs84: [104.08097, 30.65707] },
  { name: '杭州·西湖', wgs84: [120.15512, 30.27409] },
  { name: '重庆·解放碑', wgs84: [106.57711, 29.55715] },
  { name: '武汉·黄鹤楼', wgs84: [114.30533, 30.54484] },
  { name: '西安·钟楼', wgs84: [108.94233, 34.26135] },
  { name: '南京·新街口', wgs84: [118.79385, 32.04107] },
  { name: '天津·世纪钟', wgs84: [117.21674, 39.13333] },
  { name: '长沙·五一广场', wgs84: [112.97934, 28.19533] },
  { name: '郑州·二七塔', wgs84: [113.66445, 34.75226] },
  { name: '青岛·五四广场', wgs84: [120.38417, 36.06083] },
  { name: '哈尔滨·中央大街', wgs84: [126.61756, 45.77439] },
  { name: '乌鲁木齐·人民广场', wgs84: [87.61344, 43.79367] },
  { name: '昆明·东风广场', wgs84: [102.71986, 25.03956] },
  { name: '香港·中环', wgs84: [114.16037, 22.27991] },
  { name: '澳门·大三巴', wgs84: [113.54086, 22.19759] },
];

/**
 * 判定半径（度）。
 * 三种候选坐标彼此相距约 0.005°（中国大陆约 500 m）。若样本离锚点超过候选间距的一半，
 * 「离哪个候选最近」就可能指向错误的坐标系，因此可信半径取得较紧（0.001° ≈ 110 m）；
 * 放宽到 0.004°（≈ 440 m）时只是粗略提示，置信度折半。
 * 这也是锚点法的固有局限：它只对**几乎正好经过某个地标**的数据有效，
 * 任意轨迹请用 `classifyByReference()`。
 */
const RELIABLE_RADIUS = 0.001;
const FALLBACK_RADIUS = 0.004;

export interface SampleVerdict {
  coord: [number, number];
  anchorName: string;
  /** 到锚点三种候选坐标的距离（度） */
  distances: Record<CoordSystem, number>;
  verdict: CoordSystem;
}

/** 判定依据的可信程度：reliable = 样本紧邻锚点；rough = 放宽半径，仅供参考 */
export type DetectTier = 'reliable' | 'rough' | 'none';

export interface DetectResult {
  likelySystem: CoordSystem | 'UNKNOWN';
  confidence: number; // 0-1
  insideChina: boolean;
  insideChinaRatio: number;
  samples: SampleVerdict[];
  tier: DetectTier;
  message: string;
}

function randomSubset(arr: [number, number][], n: number): [number, number][] {
  if (arr.length <= n) return arr;
  const copy = arr.slice();
  // 等距采样，避免结果不稳定
  const step = Math.floor(copy.length / n);
  const out: [number, number][] = [];
  for (let i = 0; i < copy.length; i += step) {
    out.push(copy[i]);
    if (out.length >= n) break;
  }
  return out;
}

/** 以锚点坐标为准，单点判定；radius 为与锚点的最大容许距离（度） */
function classifyPoint(coord: [number, number], radius: number): SampleVerdict | null {
  let best: {
    name: string;
    dist: Record<CoordSystem, number>;
    system: CoordSystem;
  } | null = null;

  for (const a of ANCHORS) {
    const gcj = wgs84ToGcj02(a.wgs84[0], a.wgs84[1]);
    const bd = wgs84ToBd09(a.wgs84[0], a.wgs84[1]);
    const candidates: Record<CoordSystem, [number, number]> = {
      WGS84: a.wgs84,
      GCJ02: gcj,
      BD09: bd,
    };
    const dist = {} as Record<CoordSystem, number>;
    (Object.keys(candidates) as CoordSystem[]).forEach((sys) => {
      const dx = coord[0] - candidates[sys][0];
      const dy = coord[1] - candidates[sys][1];
      dist[sys] = Math.sqrt(dx * dx + dy * dy);
    });
    const system = (Object.keys(dist) as CoordSystem[]).reduce((min, k) =>
      dist[k] < dist[min] ? k : min
    ) as CoordSystem;
    const d = dist[system];
    // 只在锚点附近才可判定；否则不参与投票
    if (d > radius) continue;
    if (!best || d < best.dist[best.system]) {
      best = { name: a.name, dist, system };
    }
  }

  if (!best) return null;
  return {
    coord,
    anchorName: best.name,
    distances: best.dist,
    verdict: best.system,
  };
}

function tallyVerdicts(verdicts: SampleVerdict[]): { system: CoordSystem; confidence: number } {
  const tally: Record<string, number> = { WGS84: 0, GCJ02: 0, BD09: 0 };
  verdicts.forEach((v) => tally[v.verdict]++);
  const order: CoordSystem[] = ['WGS84', 'GCJ02', 'BD09'];
  const system = order.reduce((a, b) => (tally[a] >= tally[b] ? a : b));
  return { system, confidence: tally[system] / verdicts.length };
}

/** 从坐标数组检测 */
export function detectFromCoords(coords: Position[]): DetectResult {
  const samplesArr: [number, number][] = coords.map((c) => [
    typeof c[0] === 'number' ? c[0] : NaN,
    typeof c[1] === 'number' ? c[1] : NaN,
  ]);
  const valid = samplesArr.filter((c) => !Number.isNaN(c[0]) && !Number.isNaN(c[1]));
  const insideCount = valid.filter((c) => !outOfChina(c[0], c[1])).length;
  const insideChinaRatio = valid.length ? insideCount / valid.length : 0;
  const insideChina = insideChinaRatio > 0.5;

  const picked = randomSubset(valid, 200);

  // 先按可信半径判定；样本都不够近时再放宽半径，并标记为仅供参考
  let tier: DetectTier = 'reliable';
  let verdicts = picked
    .map((c) => classifyPoint(c, RELIABLE_RADIUS))
    .filter((v): v is SampleVerdict => v !== null);
  if (verdicts.length === 0) {
    verdicts = picked
      .map((c) => classifyPoint(c, FALLBACK_RADIUS))
      .filter((v): v is SampleVerdict => v !== null);
    if (verdicts.length > 0) tier = 'rough';
  }

  let likelySystem: CoordSystem | 'UNKNOWN' = 'UNKNOWN';
  let confidence = 0;

  if (verdicts.length > 0) {
    const t = tallyVerdicts(verdicts);
    likelySystem = t.system;
    confidence = tier === 'rough' ? t.confidence * 0.5 : t.confidence;
  } else if (valid.length > 0 && !insideChina) {
    // 样本全部位于中国境外：GCJ/BD 不生效，只能是 WGS84
    tier = 'none';
    likelySystem = 'WGS84';
    confidence = 0.95;
  } else {
    tier = 'none';
  }

  // 若完全在境外，额外压制 GCJ/BD
  if (!insideChina && verdicts.length > 0) {
    if (likelySystem !== 'WGS84') confidence *= 0.5;
  }

  let message: string;
  if (valid.length === 0) {
    message = '没有可用的坐标，无法检测。';
  } else if (likelySystem === 'UNKNOWN') {
    message =
      '无法判定：坐标本身不含判据 —— GCJ-02 / BD-09 只在中国大陆把坐标平移约 500 m，' +
      '同一点在三套坐标系下都是合法取值。内置参考锚点只覆盖 20 个城市地标，' +
      '当前样本不在其附近。请用下方「参考点校准」：切到 WGS-84 底图（OSM / Esri），' +
      '在轨迹上选一个明显地物点击其真实位置即可判定。';
  } else if (tier === 'rough') {
    message =
      `可能是 ${likelySystem}（置信度约 ${Math.round(confidence * 100)}%）——` +
      '样本距内置参考锚点较远，判定不可靠，建议用「参考点校准」复核。';
  } else {
    const ratio = Math.round(confidence * 100);
    message = `最可能是 ${likelySystem}（置信度约 ${ratio}%），基于 ${verdicts.length} 个紧邻参考锚点的样本。${
      insideChina ? '' : '数据整体在中国大陆之外，GCJ/BD 不生效。'
    }`;
  }

  return {
    likelySystem,
    confidence,
    insideChina,
    insideChinaRatio,
    samples: verdicts.slice(0, 20),
    tier,
    message,
  };
}

/* ------------------------------ 参考点校准 ------------------------------ */

/** 两点间球面距离（米） */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ReferenceMatch {
  /** 各假设下，数据中离参考点最近的样本与该参考点的距离（米） */
  distances: Record<CoordSystem, number>;
  /** 命中该最小距离的样本点（原始坐标） */
  sample: [number, number];
  best: CoordSystem;
  /** 0-1：最佳假设越贴合参考点越高 */
  confidence: number;
  /** 最佳与次佳的距离差（米）——差距越大结论越明确 */
  marginMeters: number;
  /**
   * 参考点是否可信：最佳假设下最近样本距参考点仍很近（≤ REFERENCE_TOLERANCE_M），
   * 说明参考点确实落在数据上。否则说明用户点偏了（或数据尺度不对），结论不应采信。
   */
  reliable: boolean;
}

/** 参考点被认为「点在数据上」的最大距离（米），约等于放大后的点击误差 */
export const REFERENCE_TOLERANCE_M = 100;

/**
 * 用**参考点**判定坐标系：参考点是某个地物真实的 WGS84 坐标（由用户在 WGS-84 底图上点击）。
 * 分别把数据按三种假设换算到 WGS84，取各自离参考点最近的样本，距离最小者即为答案。
 * 三种假设相距约 500 m，远大于点击误差，因此该判据可靠。
 */
export function classifyByReference(
  coords: Position[],
  refWgs84: [number, number]
): ReferenceMatch | null {
  const valid = coords
    .map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (valid.length === 0) return null;

  const systems: CoordSystem[] = ['WGS84', 'GCJ02', 'BD09'];
  const distances = {} as Record<CoordSystem, number>;
  const hits = {} as Record<CoordSystem, [number, number]>;

  for (const sys of systems) {
    let min = Infinity;
    let hit: [number, number] = valid[0];
    for (const c of valid) {
      const [lng, lat] = convertCoord(sys, 'WGS84', c) as [number, number];
      const d = haversineMeters([lng, lat], refWgs84);
      if (d < min) {
        min = d;
        hit = c;
      }
    }
    distances[sys] = min;
    hits[sys] = hit;
  }

  const sorted = systems.slice().sort((a, b) => distances[a] - distances[b]);
  const best = sorted[0];
  const margin = distances[sorted[1]] - distances[best];
  return {
    distances,
    sample: hits[best],
    best,
    confidence: Math.max(0, Math.min(1, 1 - distances[best] / 200)),
    marginMeters: margin,
    reliable: distances[best] <= REFERENCE_TOLERANCE_M,
  };
}

/** 收集 GeoJSON 中的所有坐标 */
export function collectCoords(input: { geometry?: unknown; features?: unknown[] } | null): Position[] {
  const out: Position[] = [];
  const walkArray = (arr: unknown[]): void => {
    if (arr.length === 0) return;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      out.push(arr as unknown as Position);
      return;
    }
    for (const item of arr) {
      if (Array.isArray(item)) walkArray(item);
    }
  };
  const walkGeometry = (geom: unknown): void => {
    if (!geom || typeof geom !== 'object') return;
    const g = geom as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (Array.isArray(g.coordinates)) walkArray(g.coordinates);
    else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      g.geometries.forEach(walkGeometry);
    }
  };
  if (input) {
    walkGeometry(input.geometry);
    if (Array.isArray(input.features)) {
      input.features.forEach((f) => walkGeometry((f as { geometry?: unknown }).geometry));
    }
  }
  return out;
}
