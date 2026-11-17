import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  language?: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback if clipboard unavailable
    }
  };

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/[0.08] bg-[#0B0E14] max-w-full">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface/80 border-b border-white/[0.06] text-[10px] text-text-muted">
        <span className="font-mono uppercase tracking-wider">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 text-text-secondary hover:text-text-primary transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-online" />
              <span className="text-online">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono text-text-primary/90 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match inline code, bold, italic, or http(s) URLs
  const tokenRegex = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|https?:\/\/[^\s<>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-surface border border-white/[0.08] font-mono text-[12px] text-indigo-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      nodes.push(
        <strong key={key} className="font-semibold text-text-primary">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      nodes.push(
        <em key={key} className="italic text-text-primary/95">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      // Trim common trailing sentence punctuation from URL
      const trailingMatch = token.match(/[.,!?;:)\]]+$/);
      const url = trailingMatch ? token.slice(0, -trailingMatch[0].length) : token;
      const trailing = trailingMatch ? trailingMatch[0] : '';

      nodes.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/40 hover:decoration-indigo-300 break-all transition-colors"
        >
          {url}
        </a>
      );
      if (trailing) {
        nodes.push(trailing);
      }
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

interface MarkdownContentProps {
  content: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  if (!content) return null;

  // Split by fenced code blocks: ```lang?\n...\n```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index);
      parts.push(
        <span key={`txt-${partIdx++}`} className="whitespace-pre-wrap">
          {renderInline(before, `in-${partIdx}`)}
        </span>
      );
    }

    const lang = match[1]?.trim() || undefined;
    const code = match[2].replace(/\n$/, '');
    parts.push(<CodeBlock key={`cb-${partIdx++}`} language={lang} code={code} />);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    parts.push(
      <span key={`txt-${partIdx++}`} className="whitespace-pre-wrap">
        {renderInline(remaining, `in-${partIdx}`)}
      </span>
    );
  }

  return <>{parts}</>;
};
