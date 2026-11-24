import {
  formatLocalEmbedInput,
  getLocalEmbedSpec,
  listLocalEmbedSpecs,
  type LocalEmbedModelSpec,
} from "@/lib/embed-local/catalog";
import { WEB_EMBED_CACHE_NAME } from "@/lib/embed-local/install";
import { checkEmbedModelReadiness } from "@/lib/embed-local/install";
import { isTauriEnvWithOverride } from "@/lib/tauri/env";
import {
  ProviderError,
  type EmbedProvider,
  type EmbedRequest,
  type EmbedResult,
} from "./types";

export type LocalModelRunner = (
  spec: LocalEmbedModelSpec,
  formattedInputs: string[],
  signal?: AbortSignal,
) => Promise<Float32Array[]>;

let testRunnerOverride: LocalModelRunner | null = null;

export function _setLocalEmbedRunnerForTests(
  runner: LocalModelRunner | null,
): void {
  testRunnerOverride = runner;
}

type CachedPipelineEntry = {
  modelId: string;
  run: (
    formattedInputs: string[],
  ) => Promise<Float32Array[]>;
  dispose?: () => Promise<void>;
};

let activePipeline: CachedPipelineEntry | null = null;
let fetchConfigured = false;

export function normalizeL2(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = vec[i] ?? 0;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || Math.abs(norm - 1) < 1e-5) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    out[i] = (vec[i] ?? 0) / norm;
  }
  return out;
}

/**
 * Match a Hugging Face Hub resolve URL against our curated local model catalog
 * so installed files on disk (`/__tme_embed_models/<modelId>/<relPath>`) can
 * be served directly without network traffic.
 */
export function matchLocalModelUrl(
  urlStr: string,
): { modelId: string; relPath: string } | null {
  for (const spec of listLocalEmbedSpecs()) {
    const prefix = `https://huggingface.co/${spec.hfRepo}/resolve/main/`;
    if (urlStr.startsWith(prefix)) {
      const relPath = urlStr.slice(prefix.length).split("?")[0] ?? "";
      if (relPath.length > 0 && !relPath.split("/").includes("..") && !relPath.includes("\\")) {
        return { modelId: spec.id, relPath };
      }
    }
  }
  return null;
}

async function ensureTransformersEnv(
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    fetch: (input: string | URL, init?: unknown) => Promise<Response>;
  },
): Promise<void> {
  if (fetchConfigured) return;
  fetchConfigured = true;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  // A global browser cache can contain an earlier remote response. The model
  // must only read files from an explicit installation.
  env.useBrowserCache = false;

  const baseFetch = globalThis.fetch.bind(globalThis);
  env.fetch = async (input: string | URL, init?: unknown): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const matched = matchLocalModelUrl(urlStr);

    if (matched && isTauriEnvWithOverride()) {
      const localUrl = `/__tme_embed_models/${matched.modelId}/${matched.relPath}`;
      return baseFetch(localUrl, init as RequestInit | undefined);
    }

    if (
      matched &&
      typeof window !== "undefined" &&
      "caches" in window
    ) {
      try {
        const cache = await window.caches.open(WEB_EMBED_CACHE_NAME);
        const cached = await cache.match(urlStr);
        if (cached) return cached;
      } catch {
        return new Response("Installed model cache is unavailable", { status: 503 });
      }
    }

    if (matched) {
      return new Response("Installed model file is missing", { status: 404 });
    }

    return baseFetch(input as RequestInfo, init as RequestInit | undefined);
  };
}

function sliceFlatTensor(
  data: Float32Array | number[],
  batchSize: number,
  dim: number,
  shouldNormalize: boolean,
): Float32Array[] {
  const flat =
    data instanceof Float32Array ? data : Float32Array.from(data);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < batchSize; i += 1) {
    const start = i * dim;
    const slice = flat.slice(start, start + dim);
    vectors.push(shouldNormalize ? normalizeL2(slice) : slice);
  }
  return vectors;
}

async function getOrCreatePipeline(
  spec: LocalEmbedModelSpec,
): Promise<CachedPipelineEntry> {
  if (activePipeline && activePipeline.modelId === spec.id) {
    return activePipeline;
  }
  if (activePipeline?.dispose) {
    try {
      await activePipeline.dispose();
    } catch {
      /* ignore */
    }
    activePipeline = null;
  }

  const transformers = await import("@huggingface/transformers");
  await ensureTransformersEnv(transformers.env as never);

  if (spec.architecture === "embeddinggemma") {
    const config = await transformers.AutoConfig.from_pretrained(spec.hfRepo);
    if (spec.textOnlyConfig) {
      const cfgRecord = config as unknown as Record<string, unknown>;
      cfgRecord.vision_config = null;
      cfgRecord.audio_config = null;
    }
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(
      spec.hfRepo,
    );
    const model = await transformers.AutoModel.from_pretrained(spec.hfRepo, {
      config,
      dtype: spec.dtype,
    });

    const entry: CachedPipelineEntry = {
      modelId: spec.id,
      async run(formattedInputs: string[]): Promise<Float32Array[]> {
        const encoded = await tokenizer(formattedInputs, {
          padding: true,
          truncation: true,
          max_length: spec.maxTokens,
        });
        const output = (await model(encoded)) as {
          sentence_embedding?: { data: Float32Array; dims: number[] };
          last_hidden_state?: { data: Float32Array; dims: number[] };
        };
        const tensor = output.sentence_embedding ?? output.last_hidden_state;
        if (!tensor || !tensor.data) {
          throw new Error(
            `Model ${spec.id} did not return a valid embedding tensor`,
          );
        }
        if (tensor.dims.length !== 2 || tensor.dims[0] !== formattedInputs.length) {
          throw new Error(`Model ${spec.id} returned an unexpected embedding shape`);
        }
        const resolvedDim =
          tensor.dims[tensor.dims.length - 1] ?? spec.dim;
        return sliceFlatTensor(
          tensor.data,
          formattedInputs.length,
          resolvedDim,
          spec.normalize,
        );
      },
      async dispose() {
        await (model as unknown as { dispose?: () => Promise<void> }).dispose?.();
      },
    };
    activePipeline = entry;
    return entry;
  }

  const extractor = await transformers.pipeline(
    "feature-extraction",
    spec.hfRepo,
    {
      dtype: spec.dtype,
    },
  );

  const entry: CachedPipelineEntry = {
    modelId: spec.id,
    async run(formattedInputs: string[]): Promise<Float32Array[]> {
      const output = (await extractor(formattedInputs, {
        pooling: spec.pooling,
        normalize: spec.normalize,
      })) as { data: Float32Array; dims: number[] };
      const resolvedDim =
        output.dims[output.dims.length - 1] ?? spec.dim;
      return sliceFlatTensor(
        output.data,
        formattedInputs.length,
        resolvedDim,
        spec.normalize,
      );
    },
    async dispose() {
      await (extractor as unknown as { dispose?: () => Promise<void> }).dispose?.();
    },
  };
  activePipeline = entry;
  return entry;
}

const defaultRunner: LocalModelRunner = async (
  spec,
  formattedInputs,
  signal,
) => {
  if (signal?.aborted) {
    throw new ProviderError(499, "aborted", "Embedding request aborted");
  }
  const readiness = await checkEmbedModelReadiness(spec.id);
  if (readiness.state !== "ready") {
    throw new ProviderError(404, "missing_model", `Install ${spec.name} before using it`);
  }
  const pipe = await getOrCreatePipeline(spec);
  if (signal?.aborted) {
    throw new ProviderError(499, "aborted", "Embedding request aborted");
  }
  return pipe.run(formattedInputs);
};

export class LocalOnnxEmbedProvider implements EmbedProvider {
  readonly id = "local-embed" as const;

  dimFor(model: string): number {
    const spec = getLocalEmbedSpec(model);
    return spec ? spec.dim : 384;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const spec = getLocalEmbedSpec(req.model);
    if (!spec) {
      throw new ProviderError(
        400,
        "unknown_model",
        `Unknown local embedding model: ${req.model}`,
      );
    }

    if (req.inputs.length === 0) {
      return {
        vectors: [],
        model: req.model,
        dim: spec.dim,
      };
    }

    const inputType = req.inputType ?? "document";
    const formattedInputs = req.inputs.map((text) =>
      formatLocalEmbedInput(spec, text, inputType),
    );

    const runner = testRunnerOverride ?? defaultRunner;
    try {
      const vectors = await runner(spec, formattedInputs, req.signal);
      const dim = vectors[0]?.length ?? spec.dim;
      return {
        vectors,
        model: req.model,
        dim,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        500,
        "local_embed_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
