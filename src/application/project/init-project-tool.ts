import type { ConversationId, JsonValue } from "@/domain/conversation";
import type { AgentTool } from "@/application/ports/agent-tool";
import type { TemplateCatalog } from "@/application/ports/template-catalog";
import type { PreviewCoordinator } from "@/application/preview";
import type { ApplicationSession } from "@/application/session";

export function createInitProjectTool(
  session: ApplicationSession,
  conversationId: ConversationId,
  templates: TemplateCatalog,
  preview: PreviewCoordinator,
): AgentTool {
  return {
    definition: {
      name: "init_project",
      description: `Initialize or replace the project from a supported template: ${templates.list().join(", ")}`,
      inputSchema: {
        type: "object",
        properties: { template: { type: "string", enum: templates.list() } },
        required: ["template"],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const templateName = field(input, "template");
      if (!templateName) {
        return { ok: false, error: { code: "invalid-input", message: "template must be a string" } };
      }
      const template = templates.load(templateName);
      if (!template.ok) return { ok: false, error: template.error };
      const replaced = await session.replaceProject(
        conversationId,
        template.value.tree,
        template.value.name,
      );
      if (!replaced.ok) {
        return { ok: false, error: { code: replaced.error.code, message: replaced.error.message } };
      }
      preview.request({
        conversationId,
        revision: replaced.value.revision,
        reason: "template-changed",
        restart: true,
      });
      return {
        ok: true,
        value: {
          template: template.value.name,
          revision: replaced.value.revision,
          files: template.value.tree.files.size,
        },
      };
    },
  };
}

function field(input: JsonValue, name: string): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as { readonly [key: string]: JsonValue })[name];
  return typeof value === "string" ? value : null;
}
