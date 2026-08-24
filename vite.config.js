import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      // 1. ส่ง REST API ไปยัง Express Backend พอร์ต 4000
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        timeout: 300000,      // 🔥 เพิ่มเวลา Timeout เป็น 5 นาที (300,000 ms)
        proxyTimeout: 300000, // 🔥 เพิ่มเวลา Proxy Timeout เป็น 5 นาที
      },
      // 2. 🔥 เพิ่มส่วนนี้: ส่ง Socket.IO ไปยัง Express Backend พอร์ต 4000 พร้อมเปิดใช้งาน WebSocket
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,           // สำคัญมาก! อนุญาตให้ส่งผ่าน WebSocket
        changeOrigin: true,
      },
    },
  },
  build: {
    // เพิ่มขีดจำกัดเพื่อไม่ให้แจ้งเตือน Warning รบกวน
    chunkSizeWarningLimit: 1000,
    
    // แยกไฟล์ node_modules ออกมาเป็นไฟล์แยก (ทำให้ไฟล์หลักเล็กลง)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // esptool-js is only reachable through the lazy-loaded
            // ESPFirmwareInstaller.jsx (see App.jsx's React.lazy import) -
            // forcing it into the shared "vendor" bucket like every other
            // dependency here would undo that split, since every visitor
            // downloads vendor.js upfront regardless of which page they
            // open. Leaving it unassigned lets Rollup's own import-graph
            // chunking put it in that page's own chunk instead, per
            // explicit request to cut Render bandwidth for the far more
            // common case (a regular Dashboard user who never opens the
            // firmware flashing page).
            if (id.includes("esptool-js")) return;
            return "vendor";
          }
        },
      },
    },
  },
});