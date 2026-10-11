/**
 * 捐赠配置：修改这里的链接/收款图片即可，无需改动代码。
 * - link 类型：url 为跳转地址，弹窗生成二维码，并提供"打开赞助页"按钮。
 * - qr   类型（个人微信/支付宝）：没有跳转链接，收款码是一张图片。
 *   两种填法任选其一：
 *     ① 把收款码图片放进 public/donate/ 目录，然后填写 image，如 './donate/wechat.png'；
 *     ② 若你拿得到收款码的文本/链接，填入 url，会由前端生成二维码。
 *   二者都留空时，弹窗显示"未设置"占位提示。
 */
export interface DonatePlatform {
  id: string;
  name: string;
  desc: string;
  kind: 'link' | 'qr';
  /** link 类型的跳转地址，或 qr 类型用来生成二维码的文本/链接 */
  url: string;
  /** 个人收款码图片路径（优先于 url 展示图片）。把图片放进 public/donate/ 后填 './donate/xx.png' */
  image?: string;
}

export const DONATION = {
  intro:
    'GeoTransformer 完全免费、开源、无广告。若它对你有所帮助，欢迎请作者喝杯咖啡，你的支持会让我更好地维护它。',
  platforms: [
    {
      id: 'github',
      name: 'GitHub Sponsors',
      desc: '在 GitHub 上赞助作者',
      kind: 'link',
      url: 'https://github.com/sponsors/your-name',
    },
    {
      id: 'buymeacoffee',
      name: 'Buy Me a Coffee',
      desc: '国际用户快捷打赏',
      kind: 'link',
      url: 'https://www.buymeacoffee.com/your-name',
    },
    {
      id: 'wechat',
      name: '微信收款',
      desc: '使用微信扫码支持',
      kind: 'qr',
      url: '',
      image: './donate/wechat.png',
    },
    {
      id: 'alipay',
      name: '支付宝收款',
      desc: '使用支付宝扫码支持',
      kind: 'qr',
      url: '',
      image: './donate/alipay.png',
    },
  ] as DonatePlatform[],
};
