import { useT } from "../i18n";

export function ReasoningBlock({
  text,
  open,
  defaultOpen,
  onOpenChange,
}: {
  readonly text: string;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const controlled = open !== undefined;
  return (
    <details
      className="ob-reasoning"
      {...(controlled ? { open } : { defaultOpen })}
      onToggle={(event) => {
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary>{t.chat.reasoning}</summary>
      <pre>{text}</pre>
    </details>
  );
}
