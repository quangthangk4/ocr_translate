import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Comic Lens — Dịch ảnh truyện',
    description: 'Khoanh vùng ảnh truyện và đọc bản dịch Anh–Việt ngay trên Brave.',
    permissions: ['activeTab', 'scripting', 'storage', 'offscreen', 'nativeMessaging'],
    host_permissions: ['https://generativelanguage.googleapis.com/*'],
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'" },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    commands: {
      'select-region': {
        suggested_key: { default: 'Ctrl+Shift+Y' },
        description: 'Khoanh vùng ảnh để dịch',
      },
    },
    minimum_chrome_version: '116',
    options_ui: { page: 'options.html', open_in_tab: true },
  },
});
