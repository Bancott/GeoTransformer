// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import { PROJECTIONS } from '@/core/types';
import {
  reprojectCoord,
  reprojectFeatureCollection,
  assertPlausibleReproject,
  suggestGaussKrugerVariant,
  projectionKind,
  MERC_CODE_GCJ,
} from '@/core/reproject';
import { wgs84ToGcj02 } from '@/core/coordTransform';
import type { FeatureCollection } from 'geojson';

/** 注册内置定义，供直接调用 proj4 的断言使用 */
for (const p of PROJECTIONS) {
  if (!proj4.defs(p.code)) proj4.defs(p.code, p.proj4);
}

function defOf(code: string): string {
  return PROJECTIONS.find((p) => p.code === code)?.proj4 ?? '';
}

function pointFC(lng: number, lat: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } },
    ],
  };
}

describe('CGCS2000 高斯-克吕格分带定义', () => {
  it('EPSG:4526 的参数与官方一致（38 带 / CM 114E / 东坐标含带号）', () => {
    const def = defOf('EPSG:4526');
    expect(def).toContain('+proj=tmerc');
    expect(def).toContain('+lon_0=114');
    expect(def).toContain('+x_0=38500000'); // 38 × 1e6 + 500000
    expect(def).toContain('+ellps=GRS80');
    expect(def).toContain('+units=m');
    expect(projectionKind('EPSG:4526')).toBe('projected');
  });

  it('EPSG:4547 是无带号的 CM 114E 变体（东坐标不含带号）', () => {
    expect(defOf('EPSG:4547')).toContain('+lon_0=114');
    expect(defOf('EPSG:4547')).toContain('+x_0=500000');
  });

  it('同一点的 4526 与 4547 东坐标相差 38,000,000 m，北坐标相同', () => {
    const wgs: [number, number] = [114.0, 30.0];
    const a = proj4('EPSG:4326', 'EPSG:4526', wgs);
    const b = proj4('EPSG:4326', 'EPSG:4547', wgs);
    expect(a[0] - b[0]).toBeCloseTo(38_000_000, 3);
    // 中央经线上的点：东坐标就等于 x_0
    expect(b[0]).toBeCloseTo(500000, 3);
    expect(a[0]).toBeCloseTo(38_500_000, 3);
    // 北坐标是赤道到该纬度的子午线弧长（30°N 约 3320 km），两套编码一致
    expect(a[1]).toBeCloseTo(b[1], 6);
    expect(a[1]).toBeGreaterThan(3_320_000);
    expect(a[1]).toBeLessThan(3_321_000);
  });

  it('经内置投影链往返精度良好（4526 → WGS84 → 4526）', () => {
    const wgs: [number, number] = [116.3912, 39.9075];
    const p = proj4('EPSG:4326', 'EPSG:4526', wgs);
    const back = proj4('EPSG:4526', 'EPSG:4326', p);
    expect(back[0]).toBeCloseTo(wgs[0], 6);
    expect(back[1]).toBeCloseTo(wgs[1], 6);
  });

  it('分带系列的中央经线与带号对应正确', () => {
    // 3 度带：25 带 → 75E，38 带 → 114E，45 带 → 135E
    expect(defOf('EPSG:4513')).toContain('+lon_0=75');
    expect(defOf('EPSG:4526')).toContain('+lon_0=114');
    expect(defOf('EPSG:4533')).toContain('+lon_0=135');
    // 6 度带：13 带 → 75E，23 带 → 135E
    expect(defOf('EPSG:4491')).toContain('+lon_0=75');
    expect(defOf('EPSG:4501')).toContain('+lon_0=135');
    // 无带号系列同 CM，但 x_0 固定 500000
    expect(defOf('EPSG:4534')).toContain('+lon_0=75');
    expect(defOf('EPSG:4534')).toContain('+x_0=500000');
  });

  it('每个定义都能被 proj4 解析并往返一致（无拼写错误）', () => {
    const probe: [number, number] = [110, 32]; // 中国境内的探针点
    for (const p of PROJECTIONS) {
      const fwd = proj4('EPSG:4326', p.code, probe);
      expect(Number.isFinite(fwd[0]) && Number.isFinite(fwd[1]), p.code).toBe(true);
      const back = proj4(p.code, 'EPSG:4326', fwd);
      expect(back[0], p.code).toBeCloseTo(probe[0], 6);
      expect(back[1], p.code).toBeCloseTo(probe[1], 6);
    }
  });

  it('分带系列定义的数量与编码范围正确', () => {
    const codes = PROJECTIONS.map((p) => p.code);
    // 3 度带带带号 21 个 + 无带号 21 个 + 6 度带各 11 个
    expect(codes).toContain('EPSG:4513');
    expect(codes).toContain('EPSG:4533');
    expect(codes).toContain('EPSG:4534');
    expect(codes).toContain('EPSG:4554');
    expect(codes).toContain('EPSG:4491');
    expect(codes).toContain('EPSG:4501');
    expect(codes).toContain('EPSG:4502');
    expect(codes).toContain('EPSG:4512');
    expect(codes.filter((c) => c === 'EPSG:4526')).toHaveLength(1); // 无重复
  });
});

describe('分带编码混淆的兜底拦截', () => {
  /** 一份「无带号」的 114E 数据（东坐标约 50 万米），却被当作 4526（带带号）读取 */
  const cmPoint: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [500000, 3320000] },
      },
    ],
  };

  it('把无带号数据当作带带号(4526)读：转成经纬度会明显越界并被拦下', () => {
    const out = reprojectFeatureCollection(cmPoint, 'EPSG:4526', 'EPSG:4326');
    expect(() => assertPlausibleReproject(out, 'EPSG:4326')).toThrow(/源坐标系选错了/);
    expect(() => assertPlausibleReproject(out, 'EPSG:4326')).toThrow(/带号前缀/);
  });

  it('把无带号数据当作带带号(4526)读并转火星墨卡托：直接给出可读的错误', () => {
    expect(() => reprojectFeatureCollection(cmPoint, 'EPSG:4526', MERC_CODE_GCJ)).toThrow(/投影换算失败/);
    expect(() => reprojectFeatureCollection(cmPoint, 'EPSG:4526', MERC_CODE_GCJ)).toThrow(/带号前缀/);
  });

  it('用正确的 4547 转换 → 正常且落在预期位置', () => {
    const out = reprojectFeatureCollection(cmPoint, 'EPSG:4547', 'EPSG:4326');
    expect(() => assertPlausibleReproject(out, 'EPSG:4326')).not.toThrow();
    const [lng, lat] = (out.features[0].geometry as { coordinates: number[] }).coordinates;
    expect(lng).toBeCloseTo(114, 4);
    expect(lat).toBeCloseTo(29.999, 2);
  });

  it('把米制坐标当作经纬度读取 → 结果越界被拦下', () => {
    // 误把投影坐标当成 EPSG:4490（经纬度）读取
    const wrong = reprojectFeatureCollection(cmPoint, 'EPSG:4490', 'EPSG:4326');
    expect(() => assertPlausibleReproject(wrong, 'EPSG:4326')).toThrow(/超出经纬度范围/);
    expect(() => assertPlausibleReproject(wrong, 'EPSG:4326')).toThrow(/源坐标系选错了/);

    const wrongMerc = reprojectFeatureCollection(cmPoint, 'EPSG:4490', MERC_CODE_GCJ);
    expect(() => assertPlausibleReproject(wrongMerc, MERC_CODE_GCJ)).toThrow(/Web 墨卡托/);
  });

  it('正常范围内的结果不会被误拦', () => {
    const ok = reprojectFeatureCollection(pointFC(116.39, 39.9), 'EPSG:4326', 'GCJ02');
    expect(() => assertPlausibleReproject(ok, 'GCJ02')).not.toThrow();
  });
});

describe('分带编码预检 suggestGaussKrugerVariant', () => {
  const zoneData: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [38_500_000, 3_320_000] } },
    ],
  };
  const cmData: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [500_000, 3_320_000] } },
    ],
  };

  it('带带号的数据 + 无带号编码 → 建议同中央经线的带号编码', () => {
    const hint = suggestGaussKrugerVariant(zoneData, 'EPSG:4547');
    expect(hint).toContain('EPSG:4526');
    expect(hint).toContain('带带号前缀');
    expect(hint).toContain('114E');
  });

  it('无带号的数据 + 带号编码 → 建议同中央经线的无带号编码', () => {
    const hint = suggestGaussKrugerVariant(cmData, 'EPSG:4526');
    expect(hint).toContain('EPSG:4547');
    expect(hint).toContain('不带带号前缀');
  });

  it('数据与编码量级相符时不提示', () => {
    expect(suggestGaussKrugerVariant(zoneData, 'EPSG:4526')).toBeNull();
    expect(suggestGaussKrugerVariant(cmData, 'EPSG:4547')).toBeNull();
  });

  it('非分带编码（如 Web 墨卡托）不做判断', () => {
    const merc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [12_960_000, 4_850_000] } },
      ],
    };
    expect(suggestGaussKrugerVariant(merc, 'EPSG:3857')).toBeNull();
  });

  it('不同中央经线的编码不会被误建议', () => {
    // 38 带的数据配 117E（39 带）的带号编码：中央经线不同，不应建议 4547
    const hint = suggestGaussKrugerVariant(zoneData, 'EPSG:4527');
    expect(hint).not.toBeNull();
    expect(hint).not.toContain('EPSG:4547');
  });

  it('没有坐标时返回 null', () => {
    expect(suggestGaussKrugerVariant({ type: 'FeatureCollection', features: [] }, 'EPSG:4526')).toBeNull();
  });
});

describe('4526 等高线 → 高德（实际链路）', () => {
  /** 一条位于 38 带范围内（112.5–115.5E）的等高线，坐标为 EPSG:4526 */
  const contour = ((): FeatureCollection => {
    const pts: number[][] = [];
    for (let i = 0; i < 12; i++) {
      const wgs: [number, number] = [114.0 + i * 0.001, 30.5 + Math.sin(i / 2) * 0.0008];
      const p = proj4('EPSG:4326', 'EPSG:4526', wgs);
      pts.push([p[0], p[1], 120 + i]); // 带高程
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { elevation: 120 },
          geometry: { type: 'LineString', coordinates: pts },
        },
      ],
    };
  })();

  it('东坐标确实带 38 带号前缀（与 4526 定义相符）', () => {
    const c = (contour.features[0].geometry as { coordinates: number[][] }).coordinates[0];
    expect(c[0]).toBeGreaterThanOrEqual(38_500_000); // 起点在中央经线上，正好等于 x_0
    expect(c[0]).toBeLessThan(39_500_000);
    // 带号前缀 = floor(东坐标 / 1e6)
    expect(Math.floor(c[0] / 1e6)).toBe(38);
  });

  it('4526 → GCJ02 经纬度：结果在预期位置（含 GCJ 偏移）', () => {
    const out = reprojectFeatureCollection(contour, 'EPSG:4526', 'GCJ02');
    expect(() => assertPlausibleReproject(out, 'GCJ02')).not.toThrow();
    // 期望值由坐标系偏移函数给出，避免把某地的偏移量硬编码（各地偏移方向不同）
    const expect0 = wgs84ToGcj02(114.0, 30.5);
    const c = (out.features[0].geometry as { coordinates: number[][] }).coordinates[0];
    expect(c[0]).toBeCloseTo(expect0[0], 6);
    expect(c[1]).toBeCloseTo(expect0[1], 6);
    // 与原始 WGS84 相差数百米量级
    expect(Math.abs(c[0] - 114.0)).toBeGreaterThan(0.002);
    expect(Math.abs(c[0] - 114.0)).toBeLessThan(0.009);
  });

  it('4526 → 火星墨卡托（高德瓦片投影）：坐标在有效范围内', () => {
    const out = reprojectFeatureCollection(contour, 'EPSG:4526', MERC_CODE_GCJ);
    expect(() => assertPlausibleReproject(out, MERC_CODE_GCJ)).not.toThrow();
    const c = (out.features[0].geometry as { coordinates: number[][] }).coordinates[0];
    expect(Math.abs(c[0])).toBeLessThan(20_037_509);
    expect(Math.abs(c[1])).toBeLessThan(20_037_509);
    // 与 EPSG:3857 相差 GCJ 偏移引起的量级（数百米）
    const plain = reprojectFeatureCollection(contour, 'EPSG:4526', 'EPSG:3857');
    const pc = (plain.features[0].geometry as { coordinates: number[][] }).coordinates[0];
    expect(Math.hypot(c[0] - pc[0], c[1] - pc[1])).toBeGreaterThan(100);
    expect(Math.hypot(c[0] - pc[0], c[1] - pc[1])).toBeLessThan(1500);
  });

  it('高程（第三个分量）在转换中保持不变', () => {
    const out = reprojectFeatureCollection(contour, 'EPSG:4526', 'GCJ02');
    const c = (out.features[0].geometry as { coordinates: number[][] }).coordinates;
    expect(c[0][2]).toBe(120);
    expect(c[11][2]).toBe(131);
  });

  it('属性表原样保留', () => {
    const out = reprojectFeatureCollection(contour, 'EPSG:4526', 'GCJ02');
    expect(out.features[0].properties).toEqual({ elevation: 120 });
  });

  it('单点接口 reprojectCoord 与批量接口一致', () => {
    const c = (contour.features[0].geometry as { coordinates: number[][] }).coordinates[0];
    const single = reprojectCoord([c[0], c[1]], 'EPSG:4526', 'GCJ02');
    const batch = (
      reprojectFeatureCollection(contour, 'EPSG:4526', 'GCJ02').features[0].geometry as {
        coordinates: number[][];
      }
    ).coordinates[0];
    expect(single[0]).toBeCloseTo(batch[0], 9);
    expect(single[1]).toBeCloseTo(batch[1], 9);
  });
});
