"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { envVarsApi } from "@/lib/env-var-api";
import { isValidEnvKey, parseDotenv } from "@/lib/env-var-types";

/** Only what the picker needs. A full ProjectListRow would drag a file count
 *  through three components that have no use for one. */
export type ProjectOption = { id: string; name: string };

/**
 * Add environment variables to a project, one at a time or by pasting a `.env`.
 *
 * Both modes exist because both are how this actually happens: you paste the
 * file once when a project is imported, then add one variable at a time
 * forever after. Making the paste an "import" hidden behind a second button
 * would bury the mode that gets used first.
 *
 * The paste preview is parsed with the SAME `parseDotenv` the server runs on
 * submit, so the count shown is the count that lands. The server re-parses
 * rather than trusting the preview — see the import route.
 */
export default function NewEnvVarDialog({
  projects,
  /** Preselected when the operator is already filtered to one project. */
  defaultProjectId,
}: {
  projects: ProjectOption[];
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const [dotenv, setDotenv] = useState("");

  // Reset through the open handler rather than an effect: this is an event, and
  // setState inside useEffect is a lint error in this repo.
  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (next) {
      setProjectId(defaultProjectId ?? "");
      setKey("");
      setValue("");
      setSecret(true);
      setDotenv("");
    }
  }

  const parsed = parseDotenv(dotenv);
  const keyValid = key === "" || isValidEnvKey(key);

  async function submitSingle(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) {
      toast.warning("Choose which project this belongs to.");
      return;
    }
    if (!isValidEnvKey(key)) {
      toast.warning("Use letters, digits and underscores — VITE_API_URL, not vite-api-url.");
      return;
    }

    setBusy(true);
    try {
      await envVarsApi.create({ projectId, key, value, secret });
      // Clear the value from component state the moment it is no longer needed.
      setValue("");
      setOpen(false);
      toast.success(`${key} added`);
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Could not add the variable",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitImport(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) {
      toast.warning("Choose which project this belongs to.");
      return;
    }
    if (parsed.length === 0) {
      toast.warning("Nothing to import — expected lines like KEY=value.");
      return;
    }

    setBusy(true);
    try {
      const result = await envVarsApi.import({ projectId, dotenv, secret });
      setDotenv("");
      setOpen(false);
      toast.success(
        `Imported ${result.imported} ${result.imported === 1 ? "variable" : "variables"}.`,
      );
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Could not import",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  const projectPicker = (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium">Project</Label>
      <Select
        value={projectId}
        onValueChange={setProjectId}
        disabled={busy || projects.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={
              projects.length === 0 ? "No projects yet" : "Choose a project"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const secretToggle = (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={secret}
        onChange={(event) => setSecret(event.target.checked)}
        disabled={busy}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">Secret</span>
        <span className="text-[11px] text-muted-foreground">
          Masked everywhere and never shown again. Clear it for values worth
          reading back, like a hostname or a feature flag — both are encrypted
          at rest either way.
        </span>
      </span>
    </label>
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => onOpenChange(true)}
        disabled={projects.length === 0}
      >
        <Plus />
        New variable
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New environment variable</DialogTitle>
            <DialogDescription>
              Values are encrypted before they are stored, with the same key the
              credential vault uses.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="single">
            <TabsList variant="line" className="w-full">
              <TabsTrigger value="single">One variable</TabsTrigger>
              <TabsTrigger value="paste">Paste .env</TabsTrigger>
            </TabsList>

            <TabsContent value="single">
              {/* A real form, so Enter submits without a keydown handler. */}
              <form onSubmit={submitSingle}>
                <div className="flex flex-col gap-3 py-4">
                  {projectPicker}

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="env-key" className="text-xs font-medium">
                      Name
                    </Label>
                    <Input
                      id="env-key"
                      autoFocus
                      value={key}
                      placeholder="DATABASE_URL"
                      className="font-mono text-xs"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setKey(event.target.value)}
                      disabled={busy}
                      aria-invalid={!keyValid}
                    />
                    {!keyValid && (
                      <p className="text-[11px] text-destructive">
                        Letters, digits and underscores only, starting with a
                        letter or underscore.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="env-value" className="text-xs font-medium">
                      Value
                    </Label>
                    <Input
                      id="env-value"
                      type={secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={value}
                      placeholder="postgresql://…"
                      className="font-mono text-xs"
                      onChange={(event) => setValue(event.target.value)}
                      disabled={busy}
                    />
                  </div>

                  {secretToggle}
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !projectId || !isValidEnvKey(key)}
                  >
                    {busy ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            <TabsContent value="paste">
              <form onSubmit={submitImport}>
                <div className="flex flex-col gap-3 py-4">
                  {projectPicker}

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="env-paste" className="text-xs font-medium">
                      Paste your .env
                    </Label>
                    <textarea
                      id="env-paste"
                      rows={8}
                      value={dotenv}
                      spellCheck={false}
                      placeholder={"DATABASE_URL=postgresql://…\nNODE_ENV=production\n# comments are ignored"}
                      onChange={(event) => setDotenv(event.target.value)}
                      disabled={busy}
                      className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {parsed.length > 0
                        ? `${parsed.length} ${parsed.length === 1 ? "variable" : "variables"}: ${parsed
                            .slice(0, 6)
                            .map((entry) => entry.key)
                            .join(", ")}${parsed.length > 6 ? "…" : ""}`
                        : "Comments, blank lines and `export ` prefixes are ignored. A key already set on this project is overwritten."}
                    </p>
                  </div>

                  {secretToggle}
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !projectId || parsed.length === 0}
                  >
                    {busy ? "Importing…" : `Import ${parsed.length || ""}`.trim()}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
