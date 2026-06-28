export interface PreviewElementSource {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly tag: string;
  readonly openingTag: string;
  readonly snippet: string;
}

export interface PreviewElementSelection {
  readonly conversationId: string;
  readonly revision: number;
  readonly source: PreviewElementSource;
  readonly dom: {
    readonly tag: string;
    readonly id?: string;
    readonly className?: string;
    readonly text?: string;
  };
}

export interface PreviewElementPromptRequest extends PreviewElementSelection {
  readonly requestId: string;
  readonly prompt: string;
}
