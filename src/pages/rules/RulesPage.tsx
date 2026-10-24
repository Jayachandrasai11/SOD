import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { GitCompare, History, Library, Send, Upload, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDbVersion } from "@/services/db";
import { advanceLifecycle, draftInfo } from "@/services/rulesService";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { RulesLibrary } from "./RulesLibrary";
import { RulesImport } from "./RulesImport";
import { RulesVersions } from "./RulesVersions";

const LIFECYCLE = ["Draft", "Submitted", "Approved", "Published"] as const;

function VersionBanner({ onCompare }: { onCompare: () => void }) {
  useDbVersion();
  const { can } = useApp();
  const info = draftInfo();
  const [busy, setBusy] = React.useState(false);
  const idx = LIFECYCLE.indexOf(info.status);
  const next =
    info.status === "Draft"
      ? { label: "Submit for approval", allowed: can("edit"), icon: Send }
      : info.status === "Submitted"
        ? { label: "Approve", allowed: can("approve"), icon: CheckCircle2 }
        : info.status === "Approved"
          ? { label: "Publish", allowed: can("admin"), icon: CheckCircle2 }
          : undefined;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-accent px-4 py-3 text-accent-foreground" role="region" aria-label="Ruleset version">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {info.status} v{info.version}
          {info.status === "Draft" && info.changes > 0 && <span className="font-normal"> – {info.changes} unsaved changes</span>}
        </div>
        <ol className="mt-1 flex flex-wrap items-center gap-1 text-xs" aria-label="Lifecycle">
          {LIFECYCLE.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span className={cn(i === idx ? "rounded bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground" : i < idx ? "line-through opacity-70" : "opacity-70")}>
                {s}
                {i === idx && <span className="sr-only"> (current)</span>}
              </span>
            </li>
          ))}
          <li className="ml-2 opacity-70">Published: v{info.published}</li>
        </ol>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="bg-background" onClick={onCompare}>
          <GitCompare /> Compare with published
        </Button>
        {next && (
          <Button
            size="sm"
            disabled={!next.allowed || busy}
            title={!next.allowed ? "Your role cannot perform this step" : undefined}
            onClick={async () => {
              setBusy(true);
              const s = await advanceLifecycle();
              setBusy(false);
              toast.success(`Ruleset v${info.version} is now ${s}`);
            }}
          >
            <next.icon /> {next.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function RulesPage({ embedded = false }: { embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("rulesTab") ?? (params.get("tab") && ["library", "import", "versions"].includes(params.get("tab")!) ? params.get("tab")! : "library");
  const setTab = (t: string) => {
    const p = new URLSearchParams(params);
    p.set("rulesTab", t);
    p.delete("risk");
    setParams(p, { replace: true });
  };

  return (
    <>
      {!embedded && (
        <PageHeader
          crumbs={[{ label: "Home", to: "/" }, { label: "Rules" }]}
          title="Rules"
          description="Your SoD ruleset: risks, the functions that conflict, and the SAP actions and permissions behind each function. Changes are made in a draft version and go live once published."
        />
      )}
      <div className="mb-5">
        <VersionBanner
          onCompare={() => {
            const p = new URLSearchParams(params);
            p.set("rulesTab", "versions");
            p.set("compare", "published");
            setParams(p);
          }}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">
            <Library /> Library
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload /> Import
          </TabsTrigger>
          <TabsTrigger value="versions">
            <History /> Versions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <RulesLibrary initialRisk={params.get("risk")} />
        </TabsContent>
        <TabsContent value="import">
          <RulesImport onDone={() => setTab("library")} />
        </TabsContent>
        <TabsContent value="versions">
          <RulesVersions comparePublished={params.get("compare") === "published"} />
        </TabsContent>
      </Tabs>
    </>
  );
}
