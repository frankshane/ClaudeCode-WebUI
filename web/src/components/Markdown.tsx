import { memo, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Eye, EyeOff } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: Pre,
};

export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`chat-md prose prose-sm max-w-none break-words prose-p:my-2 prose-pre:my-2.5 ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

// ---- SVG code blocks: an eye button toggles between the code and a rendered preview ----

type HastElement = NonNullable<ExtraProps['node']>;
type HastChild = HastElement['children'][number];

/** An `<svg>` root, optionally after an XML prolog, comments or a doctype. */
const SVG_START = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>/]/i;
/** Fences whose content may be sniffed for SVG; others (jsx, vue…) can hold `<svg>` that isn't plain SVG. */
const SNIFFED_LANGS = new Set(['', 'xml', 'html', 'xhtml']);

function Pre({ node, className = '', ...props }: ComponentProps<'pre'> & ExtraProps) {
  const svg = node ? svgSource(node) : null;
  if (svg === null) return <pre className={className} {...props} />;
  return (
    <SvgBlock source={svg}>
      <pre className={`${className} !my-0`} {...props} />
    </SvgBlock>
  );
}

/** The code of a fenced block when it is SVG, else null. */
function svgSource(pre: HastElement): string | null {
  const code = pre.children[0];
  if (code?.type !== 'element' || code.tagName !== 'code') return null;
  const classes = code.properties.className;
  const lang = Array.isArray(classes)
    ? (classes.map(String).find((c) => c.startsWith('language-'))?.slice('language-'.length).toLowerCase() ?? '')
    : '';
  const text = textOf(code);
  return lang === 'svg' || (SNIFFED_LANGS.has(lang) && SVG_START.test(text)) ? text : null;
}

function textOf(node: HastChild): string {
  if (node.type === 'text') return node.value;
  return node.type === 'element' ? node.children.map(textOf).join('') : '';
}

function SvgBlock({ source, children }: { source: string; children: ReactNode }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="relative my-2.5">
      {preview ? <SvgPreview source={source} /> : children}
      <button
        type="button"
        className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
        title={preview ? '显示代码' : '预览 SVG'}
        aria-pressed={preview}
        onClick={() => setPreview((p) => !p)}
      >
        {preview ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/** Smallest box a tiny SVG (a 24px icon, say) is scaled up to, so it stays legible. */
const MIN_PREVIEW = 96;

function SvgPreview({ source }: { source: string }) {
  const image = useMemo(() => svgImage(source), [source]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !image || failedSrc === image.src;
  return (
    <div className="not-prose svg-preview flex min-h-28 items-center justify-center overflow-auto rounded-xl border border-line p-5">
      {failed ? (
        <span className="text-xs">{image ? '这段 SVG 无法渲染，请检查代码' : '没有找到可渲染的 <svg> 元素'}</span>
      ) : (
        <img
          src={image.src}
          width={image.width}
          height={image.height}
          alt="SVG 预览"
          className="block h-auto max-h-[28rem] max-w-full object-contain"
          onError={() => setFailedSrc(image.src)}
        />
      )}
    </div>
  );
}

/**
 * Turns SVG source into an image URL. Parsing as HTML is lenient (missing xmlns, unclosed tags while
 * streaming) and the serializer writes proper XML back out. Showing it through <img> keeps it inert:
 * an SVG image runs no scripts and loads nothing external.
 */
function svgImage(source: string): { src: string; width: number; height: number } | null {
  const svg = new DOMParser().parseFromString(source, 'text/html').querySelector('svg');
  if (!svg) return null;
  let { width, height } = intrinsicSize(svg);
  const longest = Math.max(width, height);
  if (longest < MIN_PREVIEW) {
    width *= MIN_PREVIEW / longest;
    height *= MIN_PREVIEW / longest;
  }
  const xml = new XMLSerializer().serializeToString(svg);
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`, width: Math.round(width), height: Math.round(height) };
}

/** Size from width/height (plain or px numbers), falling back to the viewBox, then to the browser's 300×150. */
function intrinsicSize(svg: Element): { width: number; height: number } {
  const px = (value: string | null) => (value && /^\s*\d*\.?\d+\s*(px)?\s*$/.test(value) ? parseFloat(value) : 0);
  let width = px(svg.getAttribute('width'));
  let height = px(svg.getAttribute('height'));
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [boxW, boxH] = box.length === 4 && box[2] > 0 && box[3] > 0 ? [box[2], box[3]] : [300, 150];
  if (!width && !height) [width, height] = [boxW, boxH];
  else if (!height) height = (width * boxH) / boxW;
  else if (!width) width = (height * boxW) / boxH;
  return { width, height };
}
