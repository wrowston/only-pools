"use client";

import { LayersIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

const DEMO_MEMBERSHIPS = [
  {
    id: "1",
    name: "Sunday Survivors",
    meta: "Survivor · Week 4 · Owner",
    standing: { tone: "alive" as const, label: "Alive · 8/12" },
    action: { tone: "attention" as const, label: "Needs pick" },
  },
  {
    id: "2",
    name: "Office Confidence",
    meta: "Confidence · Week 4",
    standing: { tone: "neutral" as const, label: "#3 · 142 pts" },
    action: { tone: "alive" as const, label: "Pick saved" },
  },
  {
    id: "3",
    name: "Last Season Archive",
    meta: "Survivor · Week 18 · Archived",
    standing: { tone: "eliminated" as const, label: "Eliminated W11" },
    action: { tone: "neutral" as const, label: "Archived" },
  },
];

/**
 * Public visual demo of pools-dashboard shadcn adoption (no auth).
 */
export default function ShadcnPoolsDemoPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <main className="op-grid-bg-soft mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="op-eyebrow">Prototype</p>
        <h1 className="text-3xl font-medium tracking-tight text-op-text">
          Pools dashboard — shadcn
        </h1>
        <p className="text-[15px] text-op-secondary">
          Visual check of Item, Badge, Button, Empty, Skeleton, Dialog, Alert
          Dialog, Dropdown Menu, Alert, and Accordion on Only Pools tokens.
        </p>
        <Link
          href="/my-pools"
          className="text-xs font-medium text-op-selected-fg underline underline-offset-4"
        >
          Open real My Pools
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="op-eyebrow">Membership list (Item + Badge)</h2>
        <ItemGroup className="op-panel gap-0 divide-y divide-op-border overflow-hidden p-0">
          {DEMO_MEMBERSHIPS.map((m) => (
            <Item
              key={m.id}
              variant="default"
              size="sm"
              className="rounded-none border-0 px-4 py-3.5"
            >
              <ItemContent className="gap-1.5">
                <ItemTitle className="text-op-text">{m.name}</ItemTitle>
                <ItemDescription className="text-xs text-op-muted">
                  {m.meta}
                </ItemDescription>
                <Badge variant={m.standing.tone}>{m.standing.label}</Badge>
              </ItemContent>
              <ItemActions>
                <Badge variant={m.action.tone}>{m.action.label}</Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        <div className="flex flex-wrap gap-3">
          <Button>Create Pool</Button>
          <Button variant="secondary">Join a Pool</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="op-eyebrow">Empty</h2>
        <Empty className="border border-dashed border-op-border bg-op-surface/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>No Pools yet</EmptyTitle>
            <EmptyDescription>
              Create a Pool for the Available Season, or join one with an invite
              link.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            <Button>Create Pool</Button>
            <Button variant="secondary">Join a Pool</Button>
          </EmptyContent>
        </Empty>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="op-eyebrow">Skeleton loading</h2>
        <div className="op-panel divide-y divide-op-border px-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 py-3.5"
            >
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-5 w-28 rounded-[8px]" />
              </div>
              <Skeleton className="h-5 w-20 rounded-[8px]" />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="op-eyebrow">Dialog + Alert Dialog + Dropdown</h2>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger render={<Button />}>Create Pool wizard</DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Pool</DialogTitle>
                <DialogDescription>
                  Stepped wizard shell — same Dialog used on My Pools.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-op-secondary">
                Basics → Format → Rules, then share invite.
              </p>
              <DialogFooter>
                <Button variant="secondary">Cancel</Button>
                <Button>Continue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              Leave Pool
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this Pool?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will lose access until invited again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => setConfirmOpen(false)}
                >
                  Leave Pool
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" />}
              aria-label="Member actions"
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Promote Admin</DropdownMenuItem>
              <DropdownMenuItem>Offer ownership</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="op-eyebrow">Alert + Accordion (Pool panel)</h2>
        <Alert className="border-op-banner-border bg-op-banner-bg text-op-banner-fg">
          <AlertTitle>Ownership transfer pending</AlertTitle>
          <AlertDescription>Offered to you — accept to become Owner.</AlertDescription>
        </Alert>
        <Accordion
          multiple
          defaultValue={["members", "invite"]}
          className="op-panel px-3"
        >
          <AccordionItem value="invite">
            <AccordionTrigger>Pool Invite</AccordionTrigger>
            <AccordionContent>
              Retrieve or rotate the reusable invite after Step-up Verification.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="members">
            <AccordionTrigger>Members</AccordionTrigger>
            <AccordionContent>
              Roster with role actions in a dropdown menu.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="audit">
            <AccordionTrigger>Pool Audit</AccordionTrigger>
            <AccordionContent>
              Sanitized role, membership, invite, and archive events.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </main>
  );
}
