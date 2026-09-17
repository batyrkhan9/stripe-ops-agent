import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Fallback renderer for freeform answers. Structured answers render as cards instead.
// Raw HTML is not rendered, so text from Stripe data cannot inject markup.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-answer">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
