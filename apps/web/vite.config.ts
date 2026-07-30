import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        configure(proxy) {
          // Preserve the browser Host for the API Origin CSRF check. changeOrigin
          // rewrites Host to the API target (:8080), which would otherwise 403
          // every mutating /api call from the Vite origin (:5173).
          proxy.on("proxyReq", (proxyReq, req) => {
            const browserHost = req.headers.host;
            if (browserHost) {
              proxyReq.setHeader("x-forwarded-host", browserHost);
            }
          });
        },
      },
    },
  },
});
