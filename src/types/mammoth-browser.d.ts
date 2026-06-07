// Mammoth ships first-class .d.ts only at `mammoth/lib/index.d.ts`. The
// pre-built browser bundle (`mammoth.browser.min.js`) is the same surface but
// has no types. We only call `convertToHtml({ arrayBuffer })`, so a minimal
// shim is enough — and we keep `default` optional because the UMD attaches
// either to the namespace or to `default` depending on bundler interop.

declare module "mammoth/mammoth.browser.min.js" {
  type ConvertResult = { value: string; messages: unknown[] };
  type Api = {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<ConvertResult>;
  };
  const mammoth: Api & { default?: Api };
  export default mammoth;
}

declare module "mammoth/mammoth.browser.js" {
  type ConvertResult = { value: string; messages: unknown[] };
  type Api = {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<ConvertResult>;
  };
  const mammoth: Api & { default?: Api };
  export default mammoth;
}
