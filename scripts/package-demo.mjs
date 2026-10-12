import { cp, mkdir } from "node:fs/promises";
// Keep reference HTML available in the standalone preview, outside production assets.
await cp(
  new URL("../demo-reference/", import.meta.url),
  new URL("../dist-demo/demo-reference/", import.meta.url),
  { recursive: true },
);
const licenses = new URL("../dist-demo/licenses/", import.meta.url);
await mkdir(licenses, { recursive: true });
for (const name of ["Inter-OFL.txt", "NotoSerifSC-OFL.txt", "README.md"]) {
  await cp(new URL(`../src/assets/fonts/${name}`, import.meta.url), new URL(name, licenses));
}
