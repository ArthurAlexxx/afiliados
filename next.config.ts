import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // onnxruntime-web (LaMa, tirar marca d'água) roda no servidor com os arquivos .wasm do próprio pacote
  serverExternalPackages: ["onnxruntime-web", "web-push"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/onnxruntime-web/dist/ort.node.min.*", "./node_modules/onnxruntime-web/dist/*.wasm", "./node_modules/onnxruntime-web/dist/*.mjs", "./node_modules/onnxruntime-web/package.json", "./node_modules/onnxruntime-common/**/*"],
  },
};

export default nextConfig;
