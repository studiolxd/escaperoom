import { defineConfig, mergeConfig } from "vitest/config";
import base from "@escaperoom/config/vitest";

export default mergeConfig(base, defineConfig({ test: { include: ["test/**/*.test.ts"] } }));
