import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes("node_modules/recharts") || id.includes("node_modules/d3-") ? "charts"
          : id.includes("node_modules/react-dnd") || id.includes("node_modules/dnd-core") ? "dnd"
          : id.includes("node_modules/@radix-ui") || id.includes("node_modules/radix-ui") || id.includes("node_modules/cmdk") ? "radix"
          : id.includes("node_modules/react-day-picker") || id.includes("node_modules/date-fns") ? "dates"
          : id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler") ? "react"
          : undefined,
      },
    },
  },
});
