import QRCode from 'qrcode/lib/browser.js';
import { el } from '@/ui/dom';
import { openModal } from '@/ui/modal';
import { DONATION, type DonatePlatform } from '@/modules/donationConfig';

async function renderQR(canvas: HTMLCanvasElement, text: string): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, text, {
      width: 168,
      margin: 1,
      color: { dark: '#21324a', light: '#ffffff' },
    });
  } catch {
    // 二维码生成失败时忽略
  }
}

function platformCard(p: DonatePlatform): HTMLElement {
  const card = el('div', { className: 'gt-donate' });
  const meta = el('div', { className: 'gt-donate__meta' });
  const title = el('div', { className: 'gt-donate__name', text: p.name });
  const desc = el('div', { className: 'gt-donate__desc', text: p.desc });
  const canvas = el('canvas', { className: 'gt-donate__qr' });
  const hasImage = !!p.image?.trim();
  const hasUrl = !!p.url.trim();

  let visual: Node;
  if (hasImage) {
    const img = el('img', {
      className: 'gt-donate__img',
      attrs: { src: p.image!.trim(), alt: p.name },
    });
    // 图片缺失时降级为占位提示
    img.onerror = () =>
      img.replaceWith(
        el('div', {
          className: 'gt-donate__placeholder',
          text: '未找到收款图片，请检查 donationConfig.ts 中的 image 路径',
        })
      );
    visual = img;
  } else if (hasUrl) {
    renderQR(canvas, p.url);
    visual = canvas;
  } else {
    visual = el('div', {
      className: 'gt-donate__placeholder',
      text: p.kind === 'qr' ? '请在 donationConfig.ts 填写收款方式（url 或 image）' : '未设置链接',
    });
  }

  if (p.kind === 'link' && hasUrl) {
    const linkBtn = el('a', {
      className: 'gt-btn gt-btn--ghost',
      attrs: { href: p.url, target: '_blank', rel: 'noopener' },
      text: '打开赞助页',
    });
    meta.append(title, desc, linkBtn);
  } else {
    meta.append(title, desc);
  }

  card.append(meta, visual);
  return card;
}

export function openDonationModal(): void {
  const content = el('div');
  content.appendChild(
    el('p', { className: 'gt-donate__intro', text: DONATION.intro })
  );
  const grid = el('div', { className: 'gt-donate-grid' });
  DONATION.platforms.forEach((p) => grid.appendChild(platformCard(p)));
  content.appendChild(grid);
  content.appendChild(
    el('p', {
      className: 'gt-donate__tip',
      html: '所有数据都在你的浏览器中处理，不会上传到任何服务器。',
    })
  );
  openModal({ title: '支持 GeoTransformer', content, width: 'min(760px, 94vw)' });
}

export function createDonateButton(): HTMLElement {
  const btn = el('button', {
    className: 'gt-btn gt-btn--donate',
    html: '<span class="gt-heart">♥</span> 捐赠',
    onClick: openDonationModal,
  });
  return btn;
}
