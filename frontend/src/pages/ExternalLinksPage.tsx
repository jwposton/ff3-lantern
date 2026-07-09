import { useState } from "react"
import { Navigate } from "react-router-dom"
import { Pencil, Plus } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ExternalLinkSheet } from "@/components/payment-run/ExternalLinkSheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useHealth } from "@/hooks/useHealth"
import {
  externalLinkDependentsTotal,
  formatDependentsBreakdown,
  formatPortalHost,
} from "@/lib/externalLinkUtils"
import {
  createExternalLink,
  deleteExternalLink,
  externalLinksQueryKey,
  fetchExternalLinks,
  patchExternalLink,
  type ExternalLink,
} from "@/lib/paymentRunApi"

export function ExternalLinksPage() {
  const queryClient = useQueryClient()
  const { data: health, isPending: healthPending } = useHealth()
  const { data: linksData, isPending: linksPending } = useQuery({
    queryKey: externalLinksQueryKey(),
    queryFn: fetchExternalLinks,
  })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingLink, setEditingLink] = useState<ExternalLink | null>(null)

  const links = linksData?.data ?? []
  const isPending = linksPending || healthPending

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  async function invalidateExternalLinksCache() {
    await queryClient.invalidateQueries({ queryKey: externalLinksQueryKey() })
  }

  async function handleSaveLink(values: {
    id?: string
    label: string
    url: string
  }) {
    const preSaveDependents =
      values.id && editingLink
        ? externalLinkDependentsTotal(editingLink.dependents)
        : 0

    if (values.id) {
      await patchExternalLink(values.id, {
        label: values.label,
        url: values.url,
      })
    } else {
      await createExternalLink({
        label: values.label,
        url: values.url,
      })
    }

    await invalidateExternalLinksCache()

    if (values.id && preSaveDependents > 0) {
      toast.success(
        `Updated link for ${preSaveDependents} ${preSaveDependents === 1 ? "entity" : "entities"}`,
        { duration: 4000 },
      )
    }
  }

  async function handleDeleteLink(linkId: string) {
    await deleteExternalLink(linkId)
    await invalidateExternalLinksCache()
  }

  function openAddLink() {
    setEditingLink(null)
    setSheetOpen(true)
  }

  function openEditLink(link: ExternalLink) {
    setEditingLink(link)
    setSheetOpen(true)
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              External links
            </h1>
            <p className="text-muted-foreground text-sm">
              Manage external bank and bill-pay login URLs. Assign links to
              bills, liabilities, credit cards, and cash accounts from their
              edit sheets.
            </p>
          </div>
          <Button
            type="button"
            onClick={openAddLink}
            data-testid="external-links-add-button"
          >
            <Plus className="mr-2 size-4" />
            Add link
          </Button>
        </div>

        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : links.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground text-sm">
                No external links yet. Click{" "}
                <span className="font-medium text-foreground">Add link</span> to
                create one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div
            className="overflow-x-auto rounded-md border"
            data-testid="external-links-table"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead className="w-[4.5rem]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => {
                  const dependentsTotal = externalLinkDependentsTotal(
                    link.dependents,
                  )
                  const breakdown = formatDependentsBreakdown(link.dependents)
                  const badgeLabel =
                    dependentsTotal > 0
                      ? `${dependentsTotal} ${dependentsTotal === 1 ? "entity" : "entities"}`
                      : "Unused"

                  return (
                    <TableRow key={link.id} data-testid={`external-link-row-${link.id}`}>
                      <TableCell>
                        <p className="font-medium">{link.label}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatPortalHost(link.url)}
                        </p>
                      </TableCell>
                      <TableCell>
                        {dependentsTotal > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="cursor-default"
                                data-testid="external-link-dependents-badge"
                              >
                                {badgeLabel}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {breakdown}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge
                            variant="outline"
                            data-testid="external-link-dependents-badge"
                          >
                            {badgeLabel}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${link.label}`}
                          onClick={() => openEditLink(link)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <ExternalLinkSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          link={editingLink}
          onSave={handleSaveLink}
          onDelete={handleDeleteLink}
        />
      </div>
    </TooltipProvider>
  )
}
