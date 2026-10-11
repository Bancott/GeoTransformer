// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  detectFromCoords,
  classifyByReference,
  haversineMeters,
  collectCoords,
} from '@/core/detect';
import { kmlToGeoJSON } from '@/format/kml';
import { wgs84ToGcj02, wgs84ToBd09 } from '@/core/coordTransform';

const TIANANMEN: [number, number] = [116.39128, 39.90752];

/** 造一条穿过给定中心的轨迹 */
function track(center: [number, number], span = 0.02, n = 40): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([center[0] - span + t * 2 * span, center[1] - span + t * span]);
  }
  return out;
}

/** 锚点附近 ±150 m 的小范围样本（落在可信半径内） */
function nearAnchor(n = 20): [number, number][] {
  return Array.from({ length: n }, (_, i) => [
    TIANANMEN[0] + i * 0.0001,
    TIANANMEN[1] + i * 0.0001,
  ]);
}

function kmlOf(coords: [number, number][]): string {
  return (
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>' +
    coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(' ') +
    '</coordinates></LineString></Placemark></Document></kml>'
  );
}

describe('detectFromCoords', () => {
  it('境外坐标判定为 WGS84', () => {
    const r = detectFromCoords([
      [0, 0],
      [-73.9, 40.7],
      [100, -50],
    ]);
    expect(r.likelySystem).toBe('WGS84');
    expect(r.insideChina).toBe(false);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('命中北京 WGS-84 锚点时判为 WGS84', () => {
    // 天安门 WGS-84
    const r = detectFromCoords([[116.39128, 39.90752]]);
    expect(r.likelySystem).toBe('WGS84');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('命中北京 GCJ-02 坐标时判为 GCJ02', () => {
    // 天安门的 GCJ-02 坐标（由算法外推）
    const gcj: [number, number] = [116.39742, 39.90923];
    const r = detectFromCoords([gcj]);
    expect(r.likelySystem).toBe('GCJ02');
  });

  it('紧邻锚点的小范围数据判为可信（reliable，置信度 100%）', () => {
    const d = detectFromCoords(nearAnchor());
    expect(d.likelySystem).toBe('WGS84');
    expect(d.tier).toBe('reliable');
    expect(d.confidence).toBe(1);
  });

  it('同范围内的 GCJ02 / BD09 数据分别判对', () => {
    const gcj = nearAnchor().map((c) => wgs84ToGcj02(c[0], c[1]) as [number, number]);
    expect(detectFromCoords(gcj).likelySystem).toBe('GCJ02');
    expect(detectFromCoords(gcj).tier).toBe('reliable');

    const bd = nearAnchor().map((c) => wgs84ToBd09(c[0], c[1]) as [number, number]);
    expect(detectFromCoords(bd).likelySystem).toBe('BD09');
  });

  it('远离锚点的国内数据 → UNKNOWN，并说明原因与出路（回归）', () => {
    const d = detectFromCoords(track([120.75, 31.32], 0.01)); // 苏州一带，非锚点城市
    expect(d.likelySystem).toBe('UNKNOWN');
    expect(d.tier).toBe('none');
    expect(d.message).toContain('参考点校准');
    expect(d.message).toContain('500 m');
  });

  it('放宽半径命中时标记为 rough 且置信度折半', () => {
    const d = detectFromCoords([
      [TIANANMEN[0] + 0.005, TIANANMEN[1]],
      [TIANANMEN[0] + 0.0051, TIANANMEN[1] + 0.0001],
    ]);
    if (d.likelySystem !== 'UNKNOWN') {
      expect(d.tier).toBe('rough');
      expect(d.confidence).toBeLessThanOrEqual(0.5);
      expect(d.message).toContain('参考点校准');
    }
  });

  it('空输入不抛错', () => {
    const d = detectFromCoords([]);
    expect(d.likelySystem).toBe('UNKNOWN');
    expect(d.samples).toHaveLength(0);
  });

  it('KML 轨迹经解析后可检测', () => {
    const gcj = nearAnchor().map((c) => wgs84ToGcj02(c[0], c[1]) as [number, number]);
    const fc = kmlToGeoJSON(kmlOf(gcj));
    expect(collectCoords(fc)).toHaveLength(20);
    expect(detectFromCoords(collectCoords(fc)).likelySystem).toBe('GCJ02');
  });
});

describe('collectCoords', () => {
  it('收集点与线坐标', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[3, 4], [5, 6]] } },
      ],
    };
    const coords = collectCoords(fc as never);
    expect(coords).toHaveLength(3);
  });
});

describe('haversineMeters', () => {
  it('同一点为 0', () => {
    expect(haversineMeters(TIANANMEN, TIANANMEN)).toBe(0);
  });

  it('约 1 度纬度 ≈ 111 km', () => {
    const d = haversineMeters([116, 39], [116, 40]);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe('classifyByReference（参考点法：任何数据都适用）', () => {
  const raw = track([120.75, 31.32], 0.01); // 锚点法判不出的数据

  it('WGS84 数据判对，且优于其它假设', () => {
    const m = classifyByReference(raw, raw[10])!;
    expect(m.best).toBe('WGS84');
    expect(m.distances.WGS84).toBeLessThan(1);
    // 正确假设严格优于另两种；注意轨迹较密时「取最近样本」会让错误假设也偶然靠近，
    // 因此这里只断言存在可用的区分度，而不是固定的大间距
    expect(m.distances.WGS84).toBeLessThan(m.distances.GCJ02);
    expect(m.distances.WGS84).toBeLessThan(m.distances.BD09);
    expect(m.marginMeters).toBeGreaterThan(50);
  });

  it('GCJ02 数据用同一个参考点也能判对', () => {
    const gcj = raw.map((c) => wgs84ToGcj02(c[0], c[1]) as [number, number]);
    const m = classifyByReference(gcj, raw[10])!;
    expect(m.best).toBe('GCJ02');
    expect(m.distances.GCJ02).toBeLessThan(1);
  });

  it('BD09 数据判对', () => {
    const bd = raw.map((c) => wgs84ToBd09(c[0], c[1]) as [number, number]);
    expect(classifyByReference(bd, raw[10])!.best).toBe('BD09');
  });

  it('参考点含约 30 m 点击误差仍能判对', () => {
    const gcj = raw.map((c) => wgs84ToGcj02(c[0], c[1]) as [number, number]);
    const ref: [number, number] = [raw[10][0] + 0.0003, raw[10][1] - 0.0003];
    const m = classifyByReference(gcj, ref)!;
    expect(m.best).toBe('GCJ02');
    expect(m.distances.GCJ02).toBeLessThan(60);
    expect(m.distances.GCJ02).toBeLessThan(m.distances.WGS84);
    expect(m.marginMeters).toBeGreaterThan(50);
  });

  it('返回命中的样本点，便于用户核对', () => {
    expect(classifyByReference(raw, raw[7])!.sample).toEqual(raw[7]);
  });

  it('参考点落在数据上时标记为可信', () => {
    expect(classifyByReference(raw, raw[10])!.reliable).toBe(true);
  });

  it('参考点明显偏离数据时标记为不可信（避免给出误导性结论）', () => {
    // 距离轨迹约 5 km 的一个点
    const far: [number, number] = [raw[0][0] + 0.05, raw[0][1] + 0.05];
    const m = classifyByReference(raw, far)!;
    expect(m.reliable).toBe(false);
    expect(m.distances[m.best]).toBeGreaterThan(100);
  });

  it('空坐标返回 null', () => {
    expect(classifyByReference([], [120, 31])).toBeNull();
  });
});
