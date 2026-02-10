import path from "path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'out',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-codemirror-core': [
            'codemirror',
            '@codemirror/autocomplete',
            '@codemirror/commands',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/theme-one-dark',
            '@codemirror/search',
            '@codemirror/lint',
          ],
          'vendor-codemirror-langs': [
            '@codemirror/lang-javascript',
            '@codemirror/lang-python',
            '@codemirror/lang-json',
            '@codemirror/lang-markdown',
            '@codemirror/lang-sql',
            '@codemirror/lang-yaml',
            '@codemirror/lang-css',
            '@codemirror/lang-html',
          ],
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'vendor-markdown': ['react-markdown', 'react-syntax-highlighter', 'remark-gfm'],
        },
      },
    },
  },
});
