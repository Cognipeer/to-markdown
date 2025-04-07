import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/index.js",
  output: {
    file: "src/index.cjs",
    format: "cjs",
    inlineDynamicImports: true,
  },
  external: ["fs", "sharp"],
  plugins: [nodeResolve(), commonjs(), json()],
};
