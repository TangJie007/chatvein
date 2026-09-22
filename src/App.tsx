import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { listModels, listRoles, pickActiveModel } from "./api";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { BashApproval } from "./components/chat/BashApproval";
import { ChatView } from "./components/views/ChatView";
import { GroupView } from "./components/views/GroupView";
import { KnowledgeView } from "./components/views/KnowledgeView";
import { ModelsView } from "./components/views/ModelsView";
import { RolesView } from "./components/views/RolesView";
import { SettingsView } from "./components/views/SettingsView";
import { SkillsView } from "./components/views/SkillsView";
import { TooltipProvider } from "./components/ui/tooltip";
import { TraceShell } from "./components/trace/TraceWindow";
import { viewFromPathname, type NavCounts } from "./types/view";

type MainOutletContext = {
  defaultModelName: string | null;
  newChatRequestId: number;
  addModelRequestId: number;
  onConversationCount: (n: number) => void;
  onModelsChange: (info: { count: number; defaultName: string | null }) => void;
};

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        <Route path="/trace/:conversationId" element={<TraceRoute />} />
        <Route element={<MainLayout />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatOutlet />} />
          <Route path="/chat/:conversationId" element={<ChatOutlet />} />
          <Route path="/group" element={<GroupView />} />
          <Route path="/kb" element={<KnowledgeView />} />
          <Route path="/skills" element={<SkillsView />} />
          <Route path="/roles" element={<RolesView />} />
          <Route path="/models" element={<ModelsOutlet />} />
          <Route path="/settings" element={<Navigate to="/settings/app" replace />} />
          <Route path="/settings/:section" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}

function TraceRoute() {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [search] = useSearchParams();
  return (
    <TraceShell conversationId={conversationId} turnId={search.get("turn")} />
  );
}

function MainLayout() {
  const location = useLocation();
  const view = viewFromPathname(location.pathname);
  const [counts, setCounts] = useState<NavCounts>({
    chat: 1,
    group: 0,
    kb: 0,
    skills: 0,
    roles: 0,
    models: 0,
  });
  const [defaultModelName, setDefaultModelName] = useState<string | null>(null);
  const [addModelRequestId, setAddModelRequestId] = useState(0);
  const [newChatRequestId, setNewChatRequestId] = useState(0);

  useEffect(() => {
    void listRoles()
      .then((roles) => setCounts((c) => ({ ...c, roles: roles.length })))
      .catch(() => {
        /* backend may still be starting */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listModels()
      .then((models) => {
        if (cancelled) return;
        const active = pickActiveModel(models);
        setCounts((c) => ({ ...c, models: models.length }));
        setDefaultModelName(active?.name ?? null);
      })
      .catch(() => {
        /* backend may still be starting */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConversationCount = useCallback((n: number) => {
    setCounts((c) => (c.chat === n ? c : { ...c, chat: n }));
  }, []);

  const handleModelsChange = useCallback(
    ({ count, defaultName }: { count: number; defaultName: string | null }) => {
      setCounts((c) => ({ ...c, models: count }));
      setDefaultModelName(defaultName);
    },
    []
  );

  const handleNew = () => {
    if (view === "models") {
      setAddModelRequestId((n) => n + 1);
    } else if (view === "chat") {
      setNewChatRequestId((n) => n + 1);
    }
  };

  const outletContext: MainOutletContext = {
    defaultModelName,
    newChatRequestId,
    addModelRequestId,
    onConversationCount: handleConversationCount,
    onModelsChange: handleModelsChange,
  };

  return (
    <div className="relative flex h-screen w-screen min-h-[700px] min-w-[1250px] flex-col overflow-hidden bg-page font-sans text-ink-900 antialiased select-none">
      <TitleBar />

      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar counts={counts} onNew={handleNew} />

        <div className="flex min-h-0 min-w-0 flex-1 gap-[15px] pb-[15px] pr-[15px]">
          <section
            key={view}
            className="animate-view flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-surface"
          >
            <Outlet context={outletContext} />
          </section>
        </div>
      </div>
      <BashApproval />
    </div>
  );
}

function ChatOutlet() {
  const ctx = useOutletContext<MainOutletContext>();
  return (
    <ChatView
      modelName={ctx.defaultModelName ?? undefined}
      newRequestId={ctx.newChatRequestId}
      onConversationCount={ctx.onConversationCount}
    />
  );
}

function ModelsOutlet() {
  const ctx = useOutletContext<MainOutletContext>();
  return (
    <ModelsView
      addRequestId={ctx.addModelRequestId}
      onModelsChange={ctx.onModelsChange}
    />
  );
}
