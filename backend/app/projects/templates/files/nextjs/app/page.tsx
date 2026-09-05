const title = "{{project_name}}";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-neutral-500">
        Edit <code className="font-mono">app/page.tsx</code> to get started.
      </p>
    </main>
  );
}
