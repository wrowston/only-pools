import { linkifyText } from "@/lib/linkifyText";

const LINK_CLASS_NAME =
  "break-all font-medium text-op-selected-fg underline decoration-op-heat-20 underline-offset-4 hover:decoration-op-heat";

/**
 * Render plain text with http(s) URLs as external links.
 */
export function LinkifiedText({ text }: { text: string }) {
  const segments = linkifyText(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "url") {
          return (
            <a
              key={index}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS_NAME}
            >
              {segment.value}
            </a>
          );
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </>
  );
}
