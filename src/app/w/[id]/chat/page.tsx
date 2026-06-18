"use client";

/**
 * Workspace chat route (`/w/[id]/chat`).
 *
 * A hybrid-grounded study tutor that spans ALL sources in the workspace plus
 * user-toggled context (notes / concepts / roadmap / performance / web). This
 * is DISTINCT from the single-source reader chat (`/w/[id]/read/[sourceId]`),
 * which stays untouched.
 *
 * The page is thin: it mounts the `useWorkspaceChat` orchestrator hook and the
 * presentational `WorkspaceChatPanel`, wiring the two together. All chat logic
 * (retrieval, prompt assembly, streaming, tool round-trips, thread/scope
 * persistence) lives in the runner; the panel owns the chrome + composer.
 *
 * Static-export compliance: params are read via `useRouteParams` (never bare
 * `useParams`), and a `chat` case lives in `export_shell_fallback`
 * (`src-tauri/src/lib.rs`). See `feedback_static_export_dynamic_route_404`.
 */

import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { WorkspaceChatPanel } from "@/components/notebook/WorkspaceChatPanel";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useSources, useWorkspace } from "@/lib/db/hooks";
import { useWorkspaceChat } from "@/lib/ai/runners/workspace-chat-runner";
import { useRouteParams } from "@/lib/utils/route-params";

export default function WorkspaceChatPage() {
  const params = useRouteParams<{ id: string }>();
  const workspaceId = typeof params.id === "string" ? params.id : "";

  const t = useTranslations("workspace_chat");
  const pick = useLocalePick();

  const workspace = useWorkspace(workspaceId);
  const sources = useSources(workspaceId);

  const chat = useWorkspaceChat({ workspaceId });

  if (!workspaceId) {
    notFound();
  }
  // `useWorkspace` resolves to `null` for a missing/deleted workspace and
  // `undefined` while loading — only the former is a hard 404.
  if (workspace === null) {
    notFound();
  }

  const breadcrumb = workspace
    ? [pick(workspace.name, workspace.nameEn ?? workspace.name), t("title")]
    : [pick("Yükleniyor…", "Loading…"), t("title")];

  // `useSources` returns `[]` while loading, so a zero-length array on a loaded
  // workspace means the user genuinely has no sources yet. The chat still works
  // (notes / concepts / general knowledge), but we surface a gentle hint.
  const hasNoSources = (sources?.length ?? 0) === 0;

  return (
    <AppShell
      workspaceId={workspaceId}
      title={t("title")}
      breadcrumb={breadcrumb}
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="workspace-chat-page">
        <WorkspaceChatPanel
          workspaceId={workspaceId}
          threads={chat.threads}
          activeThreadId={chat.activeThreadId ?? null}
          selectThread={chat.selectThread}
          newThread={chat.newThread}
          messages={chat.messages}
          chunks={chat.chunks}
          chatStatus={chat.chatStatus}
          contextScopes={chat.contextScopes}
          setContextScopes={chat.setContextScopes}
          sources={sources ?? []}
          selectedSourceIds={chat.selectedSourceIds}
          setSelectedSourceIds={chat.setSelectedSourceIds}
          webSearchEnabled={chat.webSearchEnabled}
          setWebSearchEnabled={chat.setWebSearchEnabled}
          sendMessage={chat.sendMessage}
          cancelStream={chat.cancelStream}
          retry={chat.retry}
          fork={chat.fork}
          hasNoSources={hasNoSources}
        />
      </div>
    </AppShell>
  );
}
