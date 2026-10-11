import { el, clear } from '@/ui/dom';
import { select, field, button, card } from '@/ui/form';
import { MapController } from '@/map/mapController';
import { convertCoord } from '@/core/coordTransform';
import { COORD_SYSTEMS } from '@/core/types';
import type { CoordSystem } from '@/core/types';
import type { ToolModule } from '@/toolRegistry';

const SYSTEMS = (Object.keys(COORD_SYSTEMS) as CoordSystem[]).map((k) => ({
  value: k,
  label: COORD_SYSTEMS[k].name,
}));

export const pickerTool: ToolModule = {
  id: 'picker',
  title: '坐标拾取器',
  subtitle: '点击地图获取坐标，支持坐标系切换',
  category: 'helper',
  usesMap: true,
  mount(host, svc) {
    clear(host);

    const mapHost = el('div', { className: 'gt-map' });
    const controller = new MapController();
    controller.init(mapHost, [35, 105], 4);

    const captured: { lng: number; lat: number }[] = [];
    const list = el('div', { className: 'gt-capture-list' });

    const sysSel = select(SYSTEMS, () => undefined, 'WGS84');
    let picking = true;

    function fmt(lng: number, lat: number): string {
      const c = convertCoord('WGS84', sysSel.value as CoordSystem, [lng, lat]);
      return `${c[0].toFixed(7)}, ${c[1].toFixed(7)}`;
    }

    function addPoint(lng: number, lat: number): void {
      captured.push({ lng, lat });
      const row = el('div', { className: 'gt-capture-row' });
      const idx = el('span', { className: 'gt-capture-row__idx', text: String(captured.length) });
      const coord = el('span', { className: 'gt-capture-row__coord', text: fmt(lng, lat) });
      const copy = button('复制', () => {
        navigator.clipboard.writeText(fmt(lng, lat)).then(() => svc.toast('已复制', 'success'));
      }, 'ghost');
      row.append(idx, coord, copy);
      list.appendChild(row);
    }

    controller.setPickEnabled(true);
    controller.setPickHandler((e) => {
      addPoint(e.lng, e.lat);
      controller.placePickMarker([e.lng, e.lat], '采集点');
      svc.toast('已采集一个点', 'success');
    });

    const readout = el('div', { className: 'gt-readout' });
    controller.setMoveHandler((e) => {
      readout.textContent = `鼠标位置（${sysSel.value}）：${fmt(e.lng, e.lat)}`;
    });

    const toggle = button('停止拾取', () => {
      picking = !picking;
      controller.setPickEnabled(picking);
      toggle.textContent = picking ? '停止拾取' : '开始拾取';
      toggle.classList.toggle('gt-btn--ghost', !picking);
      svc.toast(picking ? '拾取已开启，点击地图采集' : '已暂停拾取', 'info');
    }, 'primary');

    const clearBtn = button('清空', () => {
      captured.length = 0;
      clear(list);
      controller.clearData();
      svc.toast('已清空', 'info');
    }, 'ghost');

    function onSysChange(): void {
      readout.textContent = `鼠标位置（${sysSel.value}）：—`;
      list.replaceChildren();
      captured.forEach((p, i) => {
        const row = el('div', { className: 'gt-capture-row' });
        row.append(
          el('span', { className: 'gt-capture-row__idx', text: String(i + 1) }),
          el('span', { className: 'gt-capture-row__coord', text: fmt(p.lng, p.lat) }),
          button('复制', () => {
            navigator.clipboard.writeText(fmt(p.lng, p.lat)).then(() => svc.toast('已复制', 'success'));
          }, 'ghost')
        );
        list.appendChild(row);
      });
    }
    sysSel.addEventListener('change', onSysChange);

    const baseSel = controller.createBasemapSelect();
    const controls = el('div', { className: 'gt-toolbar' }, field('坐标系', sysSel), field('底图', baseSel), toggle, clearBtn);

    const layout = el('div', { className: 'gt-stack' });
    layout.append(
      controls,
      mapHost,
      readout,
      card('已采集点', [list, el('div', { className: 'gt-note' }, '提示：拾取结果以 WGS-84 为基准，并实时换算到你选择的坐标系（无论底图是否为高德 GCJ-02 基准）。')] as Node[])
    );
    host.appendChild(layout);

    return () => controller.destroy();
  },
};
