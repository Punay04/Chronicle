export interface DurableFactCandidate {
  slot: string;
  text: string;
}

const QUESTION_PREFIX =
  /^(?:who|what|when|where|why|how|do|does|did|can|could|would|should|is|are|was|were|have|has|tell|show|find)\b/i;

function normalizeSlotPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function personalSlot(subject: string): string {
  const normalized = normalizeSlotPart(subject);
  if (["city", "home", "home city", "location", "residence"].includes(normalized)) {
    return "self:residence";
  }
  if (["company", "employer", "job", "workplace"].includes(normalized)) {
    return "self:employer";
  }
  return `self:${normalized}`;
}

function cleanStatement(value: string): string {
  return value
    .replace(/^\s*(?:please\s+)?(?:remember|note)(?:\s+that)?\s*[:,]?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();
}

function candidateForStatement(raw: string): DurableFactCandidate | null {
  const text = cleanStatement(raw);
  if (text.length < 4 || raw.trim().endsWith("?") || QUESTION_PREFIX.test(text)) {
    return null;
  }

  let match = text.match(/^(i|we)\s+(?:now\s+)?(?:live|reside)\s+in\s+(.+)$/i);
  if (match) {
    return {
      slot: `${match[1].toLowerCase() === "we" ? "group" : "self"}:residence`,
      text,
    };
  }

  match = text.match(/^i\s+(?:have\s+)?moved\s+to\s+(.+)$/i);
  if (match) return { slot: "self:residence", text };

  match = text.match(/^i\s+(?:am|'m|’m)\s+(?:now\s+)?based\s+in\s+(.+)$/i);
  if (match) return { slot: "self:residence", text };

  match = text.match(/^i\s+(?:now\s+)?(?:work|am working)\s+(?:at|for)\s+(.+)$/i);
  if (match) return { slot: "self:employer", text };

  match = text.match(/^my\s+(.{1,60}?)\s+(?:is|are|was|were|will be)\s+(.+)$/i);
  if (match) {
    const subject = normalizeSlotPart(match[1]);
    return subject ? { slot: personalSlot(subject), text } : null;
  }

  match = text.match(/^(.{2,80}?)\s+(?:is|are|was|were|will be)\s+(.+)$/i);
  if (match) {
    const subject = normalizeSlotPart(match[1]);
    return subject ? { slot: `entity:${subject}`, text } : null;
  }

  match = text.match(/^([^:]{2,80}):\s*(.+)$/);
  if (match) {
    const subject = normalizeSlotPart(match[1]);
    return subject ? { slot: `entity:${subject}`, text } : null;
  }

  return null;
}

export function extractDurableFacts(content: string): DurableFactCandidate[] {
  const statements = content
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map(candidateForStatement)
    .filter((candidate): candidate is DurableFactCandidate => Boolean(candidate));

  const seen = new Set<string>();
  return statements.filter((candidate) => {
    const key = `${candidate.slot}\u0000${candidate.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sameFactText(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}
