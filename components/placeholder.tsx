export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-3xl space-y-3">
      <div className="page-header">
        <h1>{title}</h1>
        <span className="meta">Not built yet</span>
      </div>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
