import { defineConfig } from 'vite';

// GitHub Pages はサブパス (/pointcloud-clash-check/) 配信のため相対パスでビルド
export default defineConfig({
  base: './',
});
