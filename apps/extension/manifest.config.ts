import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  "manifest_version": 3,
  "name": "TabForest",
  "version": "0.1.0",
  "description": "Remembers why you opened your tabs -- goals, open questions and where to resume.",
  "incognito": "not_allowed",
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "icons": {
    "16": "public/icons/icon-16.png",
    "32": "public/icons/icon-32.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png"
  },
  "action": {
    "default_title": "Open your Grove",
    "default_icon": {
      "16": "public/icons/icon-16.png",
      "32": "public/icons/icon-32.png"
    }
  },
  "permissions": [
    "tabs",
    "storage",
    "idle",
    "identity",
    "contextMenus",
    "activeTab",
    "scripting"
  ],
  "optional_permissions": [
    "tabGroups"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjdWh3hkU9XB7yXjzPY9+wl4rntbo3kundep6ySAG663zNsUd5JbMwrBH5BGpPtQirY2BScVGKqwFp0lmjAbVnYa2BNKI7o18I/HSnRHBVz9mUH1xYZKBdRLVTJj+f9OX469jNeKOuZQZW07SW6saJwCBanLE3S7QRfAM4EN+Q82SfCrPva2istkZO1Ts1lc0aIPydt4yAD/Hk24aC1TluEghiwki4g3F0p8N0HNwOJo6RoxN5nfhWaujbfNBcQbJzR5a1CJAMilzzqosOQdRytUX5EjogP3KW/HUwcWc7+T1opZLBEFJjhPBUBy/SpIT77zZMZH6lKlo2kC+rYBm8QIDAQAB"
});
