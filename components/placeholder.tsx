export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-2xl space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
