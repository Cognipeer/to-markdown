import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  "fs", "path", "node:fs", "node:path", "node:crypto", "node:stream",
  "node:buffer", "node:util", "node:events", "node:os", "node:url",
  "node:http", "node:https", "node:net", "node:tls", "node:zlib",
  "node:child_process", "node:worker_threads",
];

export default [
  // ESM build
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      format: "esm",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external,
    plugins: [
      nodeResolve({
        preferBuiltins: true,
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  },
  // CJS build
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.cjs",
      format: "cjs",
      sourcemap: true,
      exports: "named",
      inlineDynamicImports: true,
    },
    external,
    plugins: [
      nodeResolve({
        preferBuiltins: true,
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  },
];
