import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  CitationChip,
  findChunkForRef,
  parseCitations,
} from "@/components/notebook/CitationChip";
import type { ChunkRecord } from "@/lib/db/types";
import { cn } from "@/lib/utils/cn";

export function MarkdownPreview({
  text,
  className,
  citationChunks,
  onCitationClick,
  components: componentOverrides,
}: {
  text: string;
  className?: string;
  citationChunks?: ChunkRecord[] | undefined;
  onCitationClick?: (chunk: ChunkRecord) => void;
  components?: Components | undefined;
}) {
  const baseComponents =
    citationChunks && onCitationClick
      ? createMarkdownComponents(citationChunks, onCitationClick)
      : markdownComponents;
  const components = componentOverrides
    ? { ...baseComponents, ...componentOverrides }
    : baseComponents;
  return (
    <div className={cn("markdown-preview text-ink-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeHighlight, { detect: true }], rehypeKatex]}
        components={components}
      >
        {normalizeMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

function transformCitations(
  children: ReactNode,
  chunks: ChunkRecord[],
  onCitationClick: (chunk: ChunkRecord) => void,
): ReactNode {
  return Children.map(children, (child, idx) => {
    if (typeof child === "string") {
      const tokens = parseCitations(child);
      if (tokens.length <= 1 && tokens[0]?.kind !== "citation") return child;
      return tokens.map((token, tokenIndex) => {
        if (token.kind === "text") {
          return <Fragment key={`t-${idx}-${tokenIndex}`}>{token.text}</Fragment>;
        }
        const chunk = findChunkForRef(token.ref, chunks);
        return (
          <CitationChip
            key={`c-${idx}-${tokenIndex}`}
            ref={token.ref}
            active={!!chunk}
            onActivate={() => {
              if (chunk) onCitationClick(chunk);
            }}
          />
        );
      });
    }
    if (!isValidElement(child)) return child;
    if (child.type === "code" || child.type === "pre") return child;
    const props = child.props as { children?: ReactNode };
    if (props.children === undefined) return child;
    return cloneElement(
      child,
      {} as never,
      transformCitations(props.children, chunks, onCitationClick),
    );
  });
}

function createMarkdownComponents(
  chunks: ChunkRecord[],
  onCitationClick: (chunk: ChunkRecord) => void,
): Components {
  const wrap = (children: ReactNode) =>
    transformCitations(children, chunks, onCitationClick);
  return {
    ...markdownComponents,
    p({ children }) {
      return <p className="my-4 whitespace-pre-wrap">{wrap(children)}</p>;
    },
    li({ children }) {
      return <li className="pl-1">{wrap(children)}</li>;
    },
    h1({ children }) {
      return (
        <h1 className="mt-9 font-serif text-[28px] font-semibold leading-tight text-ink first:mt-0">
          {wrap(children)}
        </h1>
      );
    },
    h2({ children }) {
      return (
        <h2 className="mb-3 mt-10 font-serif text-[23px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3 className="mb-3 mt-9 font-serif text-[19px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h3>
      );
    },
    h4({ children }) {
      return (
        <h4 className="mb-2 mt-7 text-[15px] font-semibold leading-snug text-ink first:mt-0">
          {wrap(children)}
        </h4>
      );
    },
  };
}

const markdownComponents: Components = {
  a({ href, children }) {
    const external = href ? /^https?:\/\//i.test(href) : false;
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="font-medium text-accent underline decoration-accent/35 underline-offset-3 transition-colors hover:text-accent-hot hover:decoration-accent"
      >
        {children}
      </a>
    );
  },
  h1({ children }) {
    return (
      <h1 className="mt-9 font-serif text-[28px] font-semibold leading-tight text-ink first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mb-3 mt-10 font-serif text-[23px] font-semibold leading-snug text-ink first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mb-3 mt-9 font-serif text-[19px] font-semibold leading-snug text-ink first:mt-0">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-2 mt-7 text-[15px] font-semibold leading-snug text-ink first:mt-0">
        {children}
      </h4>
    );
  },
  p({ children }) {
    return <p className="my-4 whitespace-pre-wrap">{children}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-ink">{children}</strong>;
  },
  ul({ children }) {
    return <ul className="my-4 list-disc space-y-1.5 pl-6 marker:text-ink-4">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-ink-4">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-6 border-l-2 border-accent/55 bg-accent-wash/35 px-4 py-2 text-ink-2 [&_p]:my-2 [&_ul]:my-2">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-7 border-rule" />;
  },
  table({ children }) {
    return (
      <div className="my-7 overflow-x-auto rounded-[8px] border border-rule bg-paper">
        <table className="min-w-full border-collapse text-left text-[13.5px] leading-6">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-paper-2 text-ink">{children}</thead>;
  },
  th({ children, style }) {
    return (
      <th className="border-b border-rule px-3 py-2 font-semibold" style={style}>
        {children}
      </th>
    );
  },
  tr({ children }) {
    return <tr className="border-t border-rule-soft first:border-t-0">{children}</tr>;
  },
  td({ children, style }) {
    return (
      <td className="px-3 py-2 align-top text-ink-2" style={style}>
        {children}
      </td>
    );
  },
  code(props) {
    const { className, children, ...rest } = props;
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    return (
      <code
        className={cn(
          language
            ? "block min-w-full whitespace-pre bg-transparent font-mono text-[13px] leading-6"
            : "markdown-inline-code rounded-[4px] px-[0.28em] py-[0.12em] font-mono text-[0.9em]",
          className,
        )}
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return (
      <pre className="markdown-code-block my-6 overflow-x-auto rounded-[6px] border p-4 shadow-none">
        {children}
      </pre>
    );
  },
};

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^\s*>\s-\s/gm, "> - ")
    .replace(/^\s*>\s(?=\S)/gm, "> ");
}
