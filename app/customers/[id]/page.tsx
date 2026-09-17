import { Placeholder } from "@/components/placeholder";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Placeholder
      title={`Customer ${id}`}
      description="Payments, subscriptions, invoices, disputes, and a churn explanation for one customer."
    />
  );
}
