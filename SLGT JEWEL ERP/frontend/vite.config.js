import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildInfoPlugin() {
  return {
    name: "build-info",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "build-info.json"),
        JSON.stringify({
          built_at: new Date().toISOString(),
          source: "frontend-vite",
        }, null, 2),
      );
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    buildInfoPlugin(),
  ],
  resolve: {
    alias: {
      // More specific "@crm/domain/*" file aliases must come before the bare
      // "@crm/domain" directory alias — Vite/Rollup's alias matcher picks the
      // first prefix match in insertion order, so a general entry listed
      // first would shadow every specific one after it (e.g. "@crm/domain/billing"
      // would resolve as "<domain-dir>/billing" instead of its own mapped file).
      "@": path.resolve(__dirname, "./src"),
      "@crm/domain/money": path.resolve(__dirname, "../shared/domain/money.js"),
      "@crm/domain/billing": path.resolve(__dirname, "../shared/domain/billingCalc.js"),
      "@crm/domain/inventory": path.resolve(__dirname, "../shared/domain/inventory.js"),
      "@crm/domain/csv": path.resolve(__dirname, "../shared/domain/csvParse.js"),
      "@crm/domain": path.resolve(__dirname, "../shared/domain"),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
