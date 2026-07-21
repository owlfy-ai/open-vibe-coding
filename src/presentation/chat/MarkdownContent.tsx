import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

const components: Components = {
  a({ node: _node, href, ...props }) {
    return <a {...props} href={href} target="_blank" rel="noreferrer noopener" />;
  },
};

export function MarkdownContent({ content }: { readonly content: string }) {
  return (
    <div className="ob-markdown">
      <Markdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {content}
      </Markdown>
    </div>
  );
}
