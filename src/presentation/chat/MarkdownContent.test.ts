import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders common Markdown and GFM content", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: "## Summary\n\n- **Ready**\n- ~~Skipped~~\n\n| Name | Status |\n| --- | --- |\n| Preview | Ready |",
      }),
    );

    expect(html).toContain("<h2>Summary</h2>");
    expect(html).toContain("<strong>Ready</strong>");
    expect(html).toContain("<del>Skipped</del>");
    expect(html).toContain("<table>");
  });

  it("does not render raw HTML or unsafe links", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: '<script>alert("no")</script>\n\n[Unsafe](javascript:alert(1))\n\n[Safe](https://example.com)',
      }),
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });
});
