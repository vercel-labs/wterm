// svelte-check still loads the classic TypeScript compiler API, which
// TypeScript 7 no longer ships. Point its `typescript` imports at the
// TypeScript 6 copy in @typescript/typescript6 so the package itself can use
// TypeScript 7.
const Module = require("node:module");

const resolveFrom = (id) =>
  require.resolve(id, { paths: [process.cwd()] });

const typescript = resolveFrom("@typescript/typescript6");
const packageJson = resolveFrom("@typescript/typescript6/package.json");
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === "typescript") return typescript;
  if (request === "typescript/package.json") return packageJson;
  return resolveFilename.call(this, request, ...rest);
};
