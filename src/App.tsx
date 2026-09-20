import { useEffect, useState } from "react";
import { listModels, pickActiveModel } from "./api";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatView } from "./components/views/ChatView";
import { GroupView } from "./components/views/GroupView";
import { KnowledgeView } from "./components/views/KnowledgeView";
import { ModelsView } from "./components/views/ModelsView";
import { SettingsView } from "./components/views/SettingsView";
import { TooltipProvider } from "./components/ui/tooltip";
import type { AppView, NavCounts } from "./types/view";

export default function App() {
  const [view, setView] = useState<AppView>("chat");
  const [counts, setCounts] = useState<NavCounts>({
    chat: 1,
    group: 0,
    kb: 0,
    models: 0,
  });
  const [defaultModelName, setDefaultModelName] = useState<string | null>(null);
  const [addModelRequestId, setAddModelRequestId] = useState(0);

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

  const handleNew = () => {
    if (view === "models") {
      setAddModelRequestId((n) => n + 1);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative flex h-screen w-screen min-h-[650px] min-w-[1050px] flex-col overflow-hidden bg-page font-sans text-ink-900 antialiased select-none">
        <TitleBar />

        <div className="flex min-h-0 min-w-0 flex-1">
          <Sidebar
            view={view}
            onView={setView}
            counts={counts}
            onNew={handleNew}
          />

          <div className="flex min-h-0 min-w-0 flex-1 gap-[15px] pb-[15px] pr-[15px]">
            <section
              key={view}
              className="animate-view flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-surface"
            >
              {view === "chat" && (
                <ChatView modelName={defaultModelName ?? undefined} />
              )}
              {view === "group" && <GroupView />}
              {view === "kb" && <KnowledgeView />}
              {view === "models" && (
                <ModelsView
                  addRequestId={addModelRequestId}
                  onModelsChange={({ count, defaultName }) => {
                    setCounts((c) => ({ ...c, models: count }));
                    setDefaultModelName(defaultName);
                  }}
                />
              )}
              {view === "settings" && <SettingsView />}
            </section>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
