import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` inlines all JS/CSS into dist/index.html, so the built page
// also works when opened by double-clicking (file://), without a server.
// `npm run build:artifact` makes dist-artifact/index.html for publishing as a claude.ai artifact: only
// the site's own code is inlined, three.js and cannon-es load from jsDelivr through an import map.
const CDN = {
  three: "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js",
  "cannon-es": "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js",
};
const importMap: Plugin = {
  name: "artifact-import-map",
  transformIndexHtml: (html) => html.replace("<head>", `<head>
  <script type="importmap">${JSON.stringify({ imports: CDN })}</script>`),
};

export default defineConfig(({ mode }) =>
  mode === "artifact"
    ? {
        base: "./",
        plugins: [importMap, viteSingleFile()],
        build: { outDir: "dist-artifact", modulePreload: false, rollupOptions: { external: Object.keys(CDN) } },
      }
    : {
        base: "./",
        plugins: [viteSingleFile()],
        server: { host: true, port: 5180 },
      },
);
