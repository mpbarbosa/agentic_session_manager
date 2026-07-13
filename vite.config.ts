import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // 127.0.0.1 (not "localhost") to match the API's IPv4 loopback bind — avoids an
      // IPv6 (::1) vs IPv4 mismatch that would make the proxy connection refuse.
      "/api": `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
    },
  },
});
