import { cp } from "node:fs/promises";
// Keep reference HTML available in the standalone preview, outside production assets.
await cp(
  new URL("../demo-reference/", import.meta.url),
  new URL("../dist-demo/demo-reference/", import.meta.url),
  { recursive: true },
);
