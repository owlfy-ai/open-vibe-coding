import type { PreviewElementSource } from "@/application/preview";

export const PREVIEW_SOURCE_ATTR = "data-kvc-source-id";

export type RuntimeFiles = Record<string, {
  readonly code: string;
}>;

export interface InstrumentedPreviewSources {
  readonly files: RuntimeFiles;
  readonly sources: Readonly<Record<string, PreviewElementSource>>;
}

const INSTRUMENTABLE_FILE = /\.(?:html?|jsx|tsx)$/i;
const SKIPPED_TAGS = new Set(["script", "style", "head", "html", "meta", "link", "title"]);

export function instrumentPreviewSources(files: RuntimeFiles): InstrumentedPreviewSources {
  const sources: Record<string, PreviewElementSource> = {};
  let changed = false;
  const nextEntries = Object.entries(files).map(([path, file]) => {
    if (!INSTRUMENTABLE_FILE.test(path)) return [path, file] as const;
    const result = instrumentFile(path, file.code);
    Object.assign(sources, result.sources);
    if (result.code === file.code) return [path, file] as const;
    changed = true;
    return [path, { code: result.code }] as const;
  });

  return {
    files: changed ? Object.fromEntries(nextEntries) : files,
    sources,
  };
}

function instrumentFile(path: string, code: string): { readonly code: string; readonly sources: Record<string, PreviewElementSource> } {
  const sources: Record<string, PreviewElementSource> = {};
  let output = "";
  let lastIndex = 0;

  for (const match of findOpeningTags(code)) {
    const tag = match.tag.toLowerCase();
    const openTag = code.slice(match.start, match.end + 1);
    if (!tag || shouldSkipTag(tag, openTag)) continue;

    const insertAt = match.end - (openTag.endsWith("/>") ? 1 : 0);
    const id = `kvc-${hashString(`${path}:${match.start}:${tag}`)}`;
    const location = lineColumnAt(code, match.start);
    sources[id] = {
      id,
      file: path.replace(/^\//, ""),
      line: location.line,
      column: location.column,
      tag,
      openingTag: openTag,
      snippet: snippetAround(code, match.start),
    };
    output += code.slice(lastIndex, insertAt);
    output += ` ${PREVIEW_SOURCE_ATTR}="${id}"`;
    lastIndex = insertAt;
  }

  if (lastIndex === 0) return { code, sources };
  output += code.slice(lastIndex);
  return { code: output, sources };
}

function findOpeningTags(
  code: string,
): readonly { readonly start: number; readonly end: number; readonly tag: string }[] {
  const tags: { start: number; end: number; tag: string }[] = [];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] !== "<" || !isTagStart(code[index + 1])) continue;
    if (!isLikelyMarkupStart(code, index)) continue;
    const tag = readTagName(code, index + 1);
    if (!tag) continue;
    const end = findOpeningTagEnd(code, index + 1 + tag.length);
    if (end === -1) continue;
    tags.push({ start: index, end, tag });
    index = end;
  }
  return tags;
}

function readTagName(code: string, start: number): string {
  let end = start;
  while (end < code.length && /[a-z0-9:-]/i.test(code[end])) end += 1;
  return code.slice(start, end);
}

function findOpeningTagEnd(code: string, start: number): number {
  let quote: "'" | "\"" | "`" | null = null;
  let braceDepth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    const previous = code[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === ">" && braceDepth === 0) return index;
  }
  return -1;
}

function isTagStart(char: string | undefined): boolean {
  return !!char && /[a-z]/.test(char);
}

function isLikelyMarkupStart(code: string, index: number): boolean {
  let previousIndex = index - 1;
  while (previousIndex >= 0 && /\s/.test(code[previousIndex])) previousIndex -= 1;
  if (previousIndex < 0) return true;
  const previous = code[previousIndex];
  if (/[A-Za-z_$]/.test(previous)) {
    const word = readPreviousWord(code, previousIndex);
    return word === "return";
  }
  return !/[A-Za-z0-9_$.)\]]/.test(previous);
}

function readPreviousWord(code: string, end: number): string {
  let start = end;
  while (start >= 0 && /[A-Za-z0-9_$]/.test(code[start])) start -= 1;
  return code.slice(start + 1, end + 1);
}

function shouldSkipTag(tag: string, openTag: string): boolean {
  return SKIPPED_TAGS.has(tag) ||
    openTag.includes(PREVIEW_SOURCE_ATTR) ||
    openTag.startsWith("</") ||
    openTag.startsWith("<!") ||
    openTag.startsWith("<?");
}

function lineColumnAt(code: string, index: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let column = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (code.charCodeAt(cursor) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function snippetAround(code: string, index: number): string {
  const lines = code.split(/\r?\n/);
  let cursor = 0;
  let targetLine = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const next = cursor + lines[lineIndex].length + 1;
    if (index < next) {
      targetLine = lineIndex;
      break;
    }
    cursor = next;
  }
  const start = Math.max(0, targetLine - 6);
  const end = Math.min(lines.length, targetLine + 9);
  return lines.slice(start, end).join("\n");
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
