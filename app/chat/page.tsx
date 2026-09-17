import { Chat } from "@/components/chat/chat";
import { getActiveAccount } from "@/lib/stripe/active-account";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const account = await getActiveAccount();
  return <Chat mode={account.mode} />;
}
