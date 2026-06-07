// pdfjs-dist v5 ships the worker bundle at `legacy/build/pdf.worker.mjs` but
// only the main entry has accompanying .d.ts. We import the worker for its
// side-effect registration of GlobalWorkerOptions.workerSrc, so a minimal
// no-export shim is enough to keep TypeScript quiet.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
