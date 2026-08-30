"use client";

import Editor from "@monaco-editor/react";
import { Loader2, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { projectFilesApi } from "@/lib/project-api";

/** Monaco's language id for a path, by extension. Unknown means plain text. */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  dockerfile: "dockerfile",
};

function languageFor(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (name.toLowerCase().startsWith("dockerfile")) return "dockerfile";
  return LANGUAGES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}

/**
 * One state object rather than a `loaded` plus a `draft`.
 *
 * Two pieces of state would need an effect to seed the draft from the loaded
 * content, and calling setState in an effect is a lint error here. Holding the
 * original and the draft together means the loader produces the whole thing and
 * the effect can pass `setFile` directly.
 */
type FileState =
  | { path: string; original: string; draft: string }
  | { path: string; error: string };

/** Never rejects, so the effect can pass the setter directly. */
async function loadFile(projectId: string, path: string): Promise<FileState> {
  try {
    const file = await projectFilesApi.read(projectId, path);
    return { path, original: file.content, draft: file.content };
  } catch (err) {
    return { path, error: (err as Error).message };
  }
}

/**
 * One file, open for editing.
 *
 * Explicit save with Ctrl/Cmd+S and a dirty marker, matching WorkflowEditor
 * rather than autosaving: a save re-indexes the project and can be seen by the
 * agent mid-conversation, so it should be a thing the operator did, not a thing
 * that happened while they were typing.
 */
export default function CodeEditor({
  projectId,
  path,
  onSaved,
}: {
  projectId: string;
  path: string | null;
  onSaved?: (path: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [file, setFile] = useState<FileState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The parent keys this component by path, so a different file mounts a fresh
  // instance and there is nothing to reset here.
  useEffect(() => {
    if (path) loadFile(projectId, path).then(setFile);
  }, [projectId, path]);

  const editable = file && "draft" in file ? file : null;
  const draft = editable?.draft ?? "";
  const dirty = editable !== null && editable.draft !== editable.original;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft, path]);

  async function save() {
    if (!path || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const written = await projectFilesApi.write(projectId, path, draft);
      // The saved text becomes the new baseline, so the dirty marker clears.
      setFile({ path, original: written.content, draft: written.content });
      onSaved?.(path);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to open it.
      </div>
    );
  }

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Opening {path}…
      </div>
    );
  }

  if ("error" in file) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-md text-center text-sm text-red-700 dark:text-red-300">
          {file.error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs">{path}</span>
        {dirty && <span className="text-[11px] text-amber-600">unsaved</span>}
        {saveError && (
          <span className="truncate text-[11px] text-destructive">{saveError}</span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-6"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          <Save className="size-3" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          path={path}
          language={languageFor(path)}
          value={draft}
          onChange={(value) =>
            setFile((prev) =>
              prev && "draft" in prev ? { ...prev, draft: value ?? "" } : prev,
            )
          }
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            tabSize: 2,
            renderWhitespace: "selection",
          }}
        />
      </div>
    </div>
  );
}
