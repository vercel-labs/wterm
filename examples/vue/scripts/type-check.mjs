import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// vue-tsc drives the classic TypeScript compiler API, which TypeScript 7 no
// longer ships. Check with the TypeScript 6 copy in @typescript/typescript6
// so the project can use TypeScript 7 for everything else.
require("vue-tsc").run(require.resolve("@typescript/typescript6/lib/tsc"));
