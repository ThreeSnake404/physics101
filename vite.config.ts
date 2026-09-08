import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Project Pages URL: https://threesnake404.github.io/physics101/
  base: "/physics101/",
  plugins: [react()],
});
