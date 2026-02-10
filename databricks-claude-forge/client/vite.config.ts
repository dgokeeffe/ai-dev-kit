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
    sourcemap: false,  // Disable source maps in production for smaller bundle
    rollupOptions: {
      output: {
        // Code splitting for better caching and lazy loading
        manualChunks: (id) => {
          // Core React dependencies
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router-dom')) {
            return 'react-router';
          }

          // CodeMirror core (always needed)
          if (id.includes('node_modules/codemirror') ||
              id.includes('node_modules/@codemirror/view') ||
              id.includes('node_modules/@codemirror/state')) {
            return 'codemirror-core';
          }

          // CodeMirror languages (lazy loaded by editor)
          if (id.includes('@codemirror/lang-')) {
            return 'codemirror-langs';
          }

          // Terminal dependencies
          if (id.includes('node_modules/@xterm')) {
            return 'terminal';
          }

          // Markdown rendering (only used in chat)
          if (id.includes('node_modules/react-markdown') ||
              id.includes('node_modules/remark-') ||
              id.includes('node_modules/rehype-')) {
            return 'markdown';
          }

          // Default chunk for other node_modules
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000, // Increase limit for vendor chunks
  },
});
