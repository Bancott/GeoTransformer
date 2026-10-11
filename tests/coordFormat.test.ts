import { describe, it, expect } from 'vitest';
import {
  parseCoordValue,
  parseCoordPair,
  parseCoordLine,
  decimalToDMS,
  decimalToDegreeMinute,
  wgs84ToUtm,
  utmToWgs84,
  parseUtm,
  wgs84ToMgrs,
  mgrsToWgs84,
} from '@/core/coordFormat';

const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

describe('DMS / 度分解析', () => {
  it('度分秒', () => {
    const v = parseCoordValue('116°23\'45"E');
    expect(v?.value).toBeCloseTo(116 + 23 / 60 + 45 / 3600, 6);
    expect(v?.dir).toBe('E');
  });
  it('度分', () => {
    const v = parseCoordValue('39°54.5\'N');
    expect(v?.value).toBeCloseTo(39 + 54.5 / 60, 6);
    expect(v?.dir).toBe('N');
  });
  it('十进制直接返回', () => {
    const v = parseCoordValue('116.3958');
    expect(v?.value).toBeCloseTo(116.3958, 6);
    expect(v?.dir).toBeNull();
  });
  it('parseCoordPair 东西/南北取负', () => {
    const p = parseCoordPair('116°23\'45"W', '39°54\'27"S');
    expect(p?.[0]).toBeCloseTo(-(116 + 23 / 60 + 45 / 3600), 6);
    expect(p?.[1]).toBeCloseTo(-(39 + 54 / 60 + 27 / 3600), 6);
  });
});

describe('十进制格式化', () => {
  it('decimalToDMS', () => {
    expect(decimalToDMS(116.39583, false)).toMatch(/^116°23′\d\d\.\d\d″E$/);
    expect(decimalToDMS(-39.9, true)).toContain('S');
  });
  it('decimalToDegreeMinute', () => {
    expect(decimalToDegreeMinute(116.39583, false)).toMatch(/^116°\d+\.\d{4}′E$/);
  });
});

describe('UTM 转换', () => {
  it('wgs84ToUtm 北京为 50N', () => {
    const u = wgs84ToUtm(116.39128, 39.90752);
    expect(u.zone).toBe(50);
    expect(u.south).toBe(false);
  });
  it('UTM 往返一致', () => {
    const u = wgs84ToUtm(116.39128, 39.90752);
    const [lng, lat] = utmToWgs84(u.easting, u.northing, u.zone, u.south);
    expect(close(lng, 116.39128)).toBe(true);
    expect(close(lat, 39.90752)).toBe(true);
  });
  it('parseUtm 字符串', () => {
    const u = parseUtm('50N 123456 789012');
    expect(u).not.toBeNull();
    expect(u?.zone).toBe(50);
    expect(u?.south).toBe(false);
  });
});

describe('MGRS 转换', () => {
  it('MGRS 往返一致（约 1m）', () => {
    const lng = 116.39128;
    const lat = 39.90752;
    const mgrs = wgs84ToMgrs(lng, lat);
    const [l2, a2] = mgrsToWgs84(mgrs);
    expect(close(l2, lng, 1e-4)).toBe(true);
    expect(close(a2, lat, 1e-4)).toBe(true);
  });
});

describe('parseCoordLine 自动识别', () => {
  it('十进制', () => {
    const p = parseCoordLine('116.391,39.907');
    expect(p?.[0]).toBeCloseTo(116.391, 6);
  });
  it('DMS', () => {
    const p = parseCoordLine('116°23\'45"E,39°54\'27"N');
    expect(p?.[0]).toBeCloseTo(116 + 23 / 60 + 45 / 3600, 4);
  });
  it('UTM', () => {
    const p = parseCoordLine('50N 431088 4418657');
    expect(p).not.toBeNull();
  });
  it('MGRS', () => {
    const p = parseCoordLine('50SMK4796917670');
    expect(p).not.toBeNull();
  });
});
