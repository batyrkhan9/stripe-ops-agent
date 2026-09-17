// What the merchant sees of the model's answer text. Shared by the chat page and the format evals, so the
// evals check the rendered answer. Two format rules are enforced here because gpt-oss follows them only
// some of the time (evals/format-results.md): cards replace any list the model writes, and bold is kept once.

const STRUCTURE_LINE = /^\s*(\||[-*]\s|\d+\.\s|#)/;

// The prose before the first blank line, list, table, or heading. Empty if the answer opens with structure.
export function leadParagraph(text: string): string {
  const lead: string[] = [];
  for (const line of text.trim().split("\n")) {
    if (!line.trim() || STRUCTURE_LINE.test(line)) break;
    lead.push(line);
  }
  return lead.join(" ").trim();
}

export function keepFirstBold(text: string): string {
  let seen = false;
  return text.replace(/\*\*([^*\n]+)\*\*/g, (match, inner: string) => {
    if (seen) return inner;
    seen = true;
    return match;
  });
}

export function visibleAnswerText(text: string, hasCards: boolean): string {
  const trimmed = text.trim();
  // A lead that introduced the hidden list ("two open disputes:") ends with a period instead.
  const body = hasCards ? (leadParagraph(trimmed) || trimmed.split("\n")[0]!.trim()).replace(/:\s*$/, ".") : trimmed;
  return keepFirstBold(body);
}
