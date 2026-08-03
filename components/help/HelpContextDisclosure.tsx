import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { HelpContextDisclosure } from "@/lib/helpDiagnostics";
import { HELP_RETENTION_DAYS } from "@/lib/helpConstants";

export type HelpContextDisclosurePanelProps = {
  disclosure: HelpContextDisclosure;
  includeDiagnostics: boolean;
  onIncludeDiagnosticsChange: (value: boolean) => void;
  lane: "support" | "feedback";
};

export function HelpContextDisclosurePanel({
  disclosure,
  includeDiagnostics,
  onIncludeDiagnosticsChange,
  lane,
}: HelpContextDisclosurePanelProps) {
  const hasOptional = disclosure.optionalDiagnostics.length > 0;
  const hasIdentity = disclosure.identityContext.length > 0;
  const hasAnything =
    hasOptional || hasIdentity || !includeDiagnostics;

  return (
    <Accordion
      keepMounted
      className="rounded-[14px] border border-op-border-strong bg-op-canvas px-4"
    >
      <AccordionItem value="context" className="border-0">
        <AccordionTrigger
          id="help-context-disclosure-heading"
          className="py-3.5 hover:no-underline"
        >
          <span className="flex flex-col gap-0.5 pr-3">
            <span className="text-sm font-medium text-op-text">
              Context we may include
            </span>
            <span className="text-xs font-normal text-op-secondary">
              Optional diagnostics and account context
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <p className="text-xs leading-5 text-op-secondary">
            {lane === "feedback"
              ? "Feedback is private by default. We store submissions temporarily (up to "
              : "We store support requests temporarily (up to "}
            {HELP_RETENTION_DAYS} days), deliver them to our mailbox, and never
            include Hidden Picks, invite credentials, or other Participants&apos;
            contact details.
          </p>

          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="includeDiagnostics"
              checked={includeDiagnostics}
              onChange={(event) =>
                onIncludeDiagnosticsChange(event.target.checked)
              }
              className="mt-1"
            />
            <span>
              <span className="font-medium text-op-text">
                Include optional diagnostics
              </span>
              <span className="mt-0.5 block text-xs text-op-secondary">
                Current page, browser summary, and application version. You can
                submit without these.
              </span>
            </span>
          </label>

          {hasAnything ? (
            <div className="mt-4 space-y-4 border-t border-op-border-strong pt-4">
              {hasOptional || !includeDiagnostics ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-op-secondary">
                    Optional diagnostics
                    {!includeDiagnostics ? " (excluded)" : ""}
                  </p>
                  {includeDiagnostics && hasOptional ? (
                    <ul className="mt-2 space-y-2">
                      {disclosure.optionalDiagnostics.map((item) => (
                        <li key={item.label} className="text-sm">
                          <span className="font-medium text-op-text">
                            {item.label}:{" "}
                          </span>
                          <span className="text-op-secondary">{item.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-op-secondary">
                      None — optional diagnostics are turned off.
                    </p>
                  )}
                </div>
              ) : null}

              {hasIdentity ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-op-secondary">
                    Verified account context
                  </p>
                  <ul className="mt-2 space-y-2">
                    {disclosure.identityContext.map((item) => (
                      <li key={item.label} className="text-sm">
                        <span className="font-medium text-op-text">
                          {item.label}:{" "}
                        </span>
                        <span className="text-op-secondary">{item.value}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-op-secondary">
                    Added from your signed-in session on submission, not from
                    form fields.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-op-secondary">
              No additional context will be attached to this submission.
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
