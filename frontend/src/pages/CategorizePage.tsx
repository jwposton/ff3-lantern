import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Table } from "lucide-react"

import { FireflyTransactionLink } from "@/components/FireflyTransactionLink"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateRange } from "@/context/DateRangeContext"
import { useCategorizeMeta } from "@/hooks/useCategorizeMeta"
import { useCategorizeGroupedQueue } from "@/hooks/useCategorizeQueue"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import {
  applyCategorization,
  createRule,
  ignoreCategorization,
  previewRule,
  suggestCategorizations,
  SUGGEST_CHUNK_SIZE,
  type SuggestResultItem,
  triggerRule,
  type PendingGroup,
  type PendingRow,
  type RuleDraft,
  type RulePreviewCounts,
  type RulePreviewSampleRow,
  type SuggestionPayload,
  type DestinationMatchType,
} from "@/lib/categorizeApi"
import { invalidateReportCaches } from "@/lib/reportCache"
import {
  buildCategorizeExplorerPath,
  buildExplorerPathFromPendingRow,
  buildExplorerPathFromRuleDraft,
} from "@/lib/explorerFilterUrl"
import { formatDisplayAmount, formatDisplayDate } from "@/lib/formatDisplay"
import { cn } from "@/lib/utils"

type ApplyMode = "direct" | "rule"

type CardState = {
  suggestion?: SuggestionPayload
  categoryId: string
  budgetId: string
  error?: string
  mode: ApplyMode
  applyDescription: string
  ruleTitle: string
  ruleDescriptionContains: string
  ruleDestinationAccount: string
  ruleDestinationMatchType: DestinationMatchType
  ruleTransactionType: "" | "withdrawal" | "deposit"
  ruleAmount: string
  preview: RulePreviewCounts | null
  previewError?: string
  ruleError?: string
  backfillOptIn: boolean
}

function hasRuleTrigger(state: CardState | undefined): boolean {
  return Boolean(
    (state?.ruleDescriptionContains ?? "").trim() ||
      (state?.ruleDestinationAccount ?? "").trim(),
  )
}

function defaultRuleAmount(amount: string | undefined): string {
  if (!amount) return ""
  const parsed = Math.abs(parseFloat(amount))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : ""
}

function ruleDraftFromState(state: CardState): RuleDraft {
  const txType = state.ruleTransactionType
  const amount = (state.ruleAmount ?? "").trim()
  return {
    title: state.ruleTitle ?? "",
    description_contains: state.ruleDescriptionContains ?? "",
    destination_account: (state.ruleDestinationAccount ?? "").trim() || null,
    destination_match_type: state.ruleDestinationMatchType ?? "is",
    transaction_type:
      txType === "withdrawal" || txType === "deposit" ? txType : null,
    amount: amount || null,
  }
}

function ensureCardState(
  existing: CardState | undefined,
  row: PendingRow,
  overrides: Partial<CardState> = {},
): CardState {
  const defaults = defaultCardState(existing?.suggestion, row)
  return {
    ...defaults,
    ...existing,
    ...overrides,
  }
}

function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.8) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
  }
  if (confidence >= 0.5) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
  }
  return "bg-muted text-muted-foreground"
}

function selectClassName(): string {
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-8 w-full rounded-md border px-2 py-0.5 text-xs shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
}

function inputClassName(): string {
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-8 w-full rounded-md border px-2 py-0.5 text-xs shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
}

function previewCell(value: string | null | undefined): string {
  if (value == null || value === "") return "—"
  return value
}

function RuleMatchPreviewTable({ rows }: { rows: RulePreviewSampleRow[] }) {
  if (rows.length === 0) return null
  const head =
    "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
  const cell = "px-2 py-1.5 text-sm align-middle"
  return (
    <div className="overflow-x-auto rounded-md bg-muted/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className={head}>Date</th>
            <th className={cn(head, "text-right")}>Amount</th>
            <th className={head}>From</th>
            <th className={head}>To</th>
            <th className={head}>Description</th>
            <th className={head}>Budget</th>
            <th className={head}>Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.date}-${row.amount}-${index}`}
              className="border-b border-border/30 last:border-0"
            >
              <td className={cn(cell, "text-muted-foreground whitespace-nowrap")}>
                {formatDisplayDate(row.date)}
              </td>
              <td className={cn(cell, "text-right font-medium tabular-nums whitespace-nowrap")}>
                {formatDisplayAmount(row.amount)}
              </td>
              <td className={cn(cell, "max-w-[8rem] truncate")} title={row.source_name ?? ""}>
                {previewCell(row.source_name)}
              </td>
              <td className={cn(cell, "max-w-[8rem] truncate")} title={row.destination_name ?? ""}>
                {previewCell(row.destination_name)}
              </td>
              <td className={cn(cell, "max-w-[12rem] truncate")} title={row.description}>
                {row.description}
              </td>
              <td className={cn(cell, "max-w-[8rem] truncate")}>
                {previewCell(row.budget_name)}
              </td>
              <td className={cn(cell, "max-w-[8rem] truncate")}>
                {previewCell(row.category_name)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function effectiveApplyDescription(
  state: CardState | undefined,
  row: PendingRow,
): string {
  if (state === undefined) return row.description ?? ""
  return state.applyDescription ?? row.description ?? ""
}

function defaultCardState(
  suggestion?: SuggestionPayload,
  row?: PendingRow,
): CardState {
  const mode: ApplyMode =
    suggestion?.recommendation === "rule" ? "rule" : "direct"
  const rowType =
    row?.type === "withdrawal" || row?.type === "deposit" ? row.type : ""
  return {
    suggestion,
    categoryId: "",
    budgetId: "",
    mode,
    applyDescription: row?.description ?? "",
    ruleTitle: suggestion?.rule?.title ?? "",
    ruleDescriptionContains: row?.description ?? "",
    ruleDestinationAccount:
      suggestion?.rule?.destination_account ?? row?.destination_name ?? "",
    ruleDestinationMatchType:
      suggestion?.rule?.destination_match_type ?? "is",
    ruleTransactionType: suggestion?.rule?.transaction_type ?? rowType,
    ruleAmount:
      suggestion?.rule?.amount != null
        ? defaultRuleAmount(suggestion.rule.amount)
        : defaultRuleAmount(row?.amount),
    preview: null,
    backfillOptIn: false,
  }
}

function categorizeCardExplorerPath(
  rangeStart: string,
  rangeEnd: string,
  row: PendingRow,
  state: CardState | undefined,
  mode: ApplyMode,
): string {
  if (mode === "rule" && state && hasRuleTrigger(state)) {
    return buildExplorerPathFromRuleDraft(
      rangeStart,
      rangeEnd,
      ruleDraftFromState(state),
    )
  }
  return buildExplorerPathFromPendingRow(rangeStart, rangeEnd, row)
}

function CardExplorerLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-8">
      <Link to={to}>
        <Table className="mr-2 h-4 w-4" />
        {label}
      </Link>
    </Button>
  )
}

function TransactionCard({
  row,
  state,
  categories,
  budgets,
  fireflyBaseUrl,
  approvingId,
  previewingId,
  creatingRuleId,
  approveErrors,
  onCategoryChange,
  onBudgetChange,
  onModeChange,
  onApplyDescriptionChange,
  onRuleTitleChange,
  onRuleDescriptionChange,
  onRuleDestinationChange,
  onRuleDestinationMatchTypeChange,
  onRuleTransactionTypeChange,
  onRuleAmountChange,
  onBackfillChange,
  onApprove,
  onPreview,
  onCreateRule,
  onIgnore,
  groupJournalIds,
  ignoringId,
  rangeStart,
  rangeEnd,
}: {
  row: PendingRow
  state: CardState | undefined
  categories: Array<{ id: string; name: string }>
  budgets: Array<{ id: string; name: string }>
  fireflyBaseUrl: string | undefined
  approvingId: string | null
  previewingId: string | null
  creatingRuleId: string | null
  approveErrors: Record<string, string>
  onCategoryChange: (journalId: string, categoryId: string) => void
  onBudgetChange: (journalId: string, budgetId: string) => void
  onModeChange: (journalId: string, mode: ApplyMode) => void
  onApplyDescriptionChange: (journalId: string, value: string) => void
  onRuleTitleChange: (journalId: string, title: string) => void
  onRuleDescriptionChange: (journalId: string, value: string) => void
  onRuleDestinationChange: (journalId: string, value: string) => void
  onRuleDestinationMatchTypeChange: (
    journalId: string,
    value: DestinationMatchType,
  ) => void
  onRuleTransactionTypeChange: (
    journalId: string,
    value: "" | "withdrawal" | "deposit",
  ) => void
  onRuleAmountChange: (journalId: string, value: string) => void
  onBackfillChange: (journalId: string, checked: boolean) => void
  onApprove: (row: PendingRow) => void
  onPreview: (journalId: string) => void
  onCreateRule: (row: PendingRow, groupJournalIds: string[]) => void
  onIgnore: (row: PendingRow) => void
  groupJournalIds: string[]
  ignoringId: string | null
  rangeStart: string
  rangeEnd: string
}) {
  const mode = state?.mode ?? "direct"
  const previewReady = state?.preview != null && !state.previewError
  const applyDescription = effectiveApplyDescription(state, row)
  const explorerPath = categorizeCardExplorerPath(
    rangeStart,
    rangeEnd,
    row,
    state,
    mode,
  )
  const explorerLinkLabel =
    mode === "rule" && state?.preview ? "Open matches in Explorer" : "Open in Explorer"

  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardHeader className="gap-1 border-b px-4 py-2.5 pb-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">
            {formatDisplayDate(row.date)}
          </span>
          <p className="min-w-0 truncate font-medium" title={row.description}>
            {row.description}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="font-medium tabular-nums">
              {formatDisplayAmount(row.amount)}
            </span>
            <FireflyTransactionLink
              fireflyBaseUrl={fireflyBaseUrl}
              journalId={row.journal_id}
            />
          </div>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {row.source_name} → {row.destination_name}
        </p>
      </CardHeader>
      <CardContent className="space-y-2.5 px-4 py-3">
        {state?.suggestion?.rationale ? (
          <p className="text-xs text-muted-foreground">{state.suggestion.rationale}</p>
        ) : null}
        {state?.error ? (
          <p className="text-xs text-destructive">
            {state.error.includes("allowlist")
              ? "Category not recognized. Pick from the dropdown."
              : "Suggestion failed for this transaction."}
          </p>
        ) : null}
        {approveErrors[row.journal_id] ? (
          <p className="text-xs text-destructive">{approveErrors[row.journal_id]}</p>
        ) : null}
        {state?.ruleError ? (
          <p className="text-xs text-destructive">{state.ruleError}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            variant={mode === "direct" ? "default" : "outline"}
            onClick={() => {
              onModeChange(row.journal_id, "direct")
            }}
          >
            Transaction
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            variant={mode === "rule" ? "default" : "outline"}
            onClick={() => {
              onModeChange(row.journal_id, "rule")
            }}
          >
            Rule
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Category
            <select
              className={selectClassName()}
              value={state?.categoryId ?? ""}
              onChange={(e) => {
                onCategoryChange(row.journal_id, e.target.value)
              }}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Budget
            <select
              className={selectClassName()}
              value={state?.budgetId ?? ""}
              onChange={(e) => {
                onBudgetChange(row.journal_id, e.target.value)
              }}
            >
              <option value="">None</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {state?.suggestion != null ? (
            <Badge
              className={cn(
                "h-7 shrink-0 self-end px-2 text-xs",
                confidenceBadgeClass(state.suggestion.confidence),
              )}
            >
              {Math.round(state.suggestion.confidence * 100)}%
            </Badge>
          ) : null}
        </div>

        {mode === "rule" ? (
          <div className="space-y-2 rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">
              Rule matches when every condition below is met.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
                Rule title
                <input
                  className={inputClassName()}
                  value={state?.ruleTitle ?? ""}
                  onChange={(e) => {
                    onRuleTitleChange(row.journal_id, e.target.value)
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Description contains
                <input
                  className={inputClassName()}
                  placeholder="Transaction description"
                  value={state?.ruleDescriptionContains ?? ""}
                  onChange={(e) => {
                    onRuleDescriptionChange(row.journal_id, e.target.value)
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Amount (optional)
                <input
                  className={inputClassName()}
                  type="text"
                  inputMode="decimal"
                  placeholder="Any amount"
                  value={state?.ruleAmount ?? ""}
                  onChange={(e) => {
                    onRuleAmountChange(row.journal_id, e.target.value)
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium sm:col-span-2">
                Destination (payee)
                <div className="flex gap-2">
                  <select
                    className={cn(selectClassName(), "w-auto shrink-0")}
                    value={state?.ruleDestinationMatchType ?? "is"}
                    onChange={(e) => {
                      onRuleDestinationMatchTypeChange(
                        row.journal_id,
                        e.target.value as DestinationMatchType,
                      )
                    }}
                  >
                    <option value="contains">Contains</option>
                    <option value="starts_with">Starts with</option>
                    <option value="ends_with">Ends with</option>
                    <option value="is">Is exactly</option>
                  </select>
                  <input
                    className={inputClassName()}
                    placeholder={
                      state?.ruleDestinationMatchType === "is"
                        ? "Exact account name"
                        : "Payee fragment"
                    }
                    value={state?.ruleDestinationAccount ?? ""}
                    onChange={(e) => {
                      onRuleDestinationChange(row.journal_id, e.target.value)
                    }}
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Transaction type
                <select
                  className={selectClassName()}
                  value={state?.ruleTransactionType ?? ""}
                  onChange={(e) => {
                    onRuleTransactionTypeChange(
                      row.journal_id,
                      e.target.value as "" | "withdrawal" | "deposit",
                    )
                  }}
                >
                  <option value="">Any</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="deposit">Deposit</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs"
                variant="outline"
                disabled={!hasRuleTrigger(state) || previewingId === row.journal_id}
                onClick={() => {
                  onPreview(row.journal_id)
                }}
              >
                {previewingId === row.journal_id ? "Previewing…" : "Preview matches"}
              </Button>
              {state?.preview ? (
                <span className="text-xs text-muted-foreground">
                  {state.preview.total} matching · {state.preview.uncategorized_count}{" "}
                  uncategorized · {state.preview.categorized_count} categorized
                </span>
              ) : null}
            </div>
            {state?.previewError ? (
              <p className="text-xs text-destructive">{state.previewError}</p>
            ) : null}
            {state?.preview?.sample?.length ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Matching transactions
                    {state.preview.total > state.preview.sample.length
                      ? ` (showing ${state.preview.sample.length} of ${state.preview.total})`
                      : null}
                  </p>
                  <CardExplorerLink to={explorerPath} label={explorerLinkLabel} />
                </div>
                <RuleMatchPreviewTable rows={state.preview.sample} />
              </div>
            ) : hasRuleTrigger(state) ? (
              <CardExplorerLink to={explorerPath} label="Open in Explorer" />
            ) : null}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={state?.backfillOptIn ?? false}
                onChange={(e) => {
                  onBackfillChange(row.journal_id, e.target.checked)
                }}
              />
              Apply rule to existing transactions in this date range
            </label>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={
                !state?.categoryId ||
                !previewReady ||
                creatingRuleId === row.journal_id
              }
              onClick={() => {
                onCreateRule(row, groupJournalIds)
              }}
            >
              {creatingRuleId === row.journal_id ? "Creating…" : "Create rule"}
            </Button>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Description
              <input
                className={inputClassName()}
                value={applyDescription}
                onChange={(e) => {
                  onApplyDescriptionChange(row.journal_id, e.target.value)
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={!state?.categoryId || approvingId === row.journal_id}
                onClick={() => {
                  onApprove(row)
                }}
              >
                {approvingId === row.journal_id ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8"
                variant="outline"
                disabled={ignoringId === row.journal_id}
                onClick={() => {
                  onIgnore(row)
                }}
              >
                Ignore
              </Button>
              <CardExplorerLink to={explorerPath} label="Open in Explorer" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function CategorizePage() {
  const queryClient = useQueryClient()
  const { committedRange } = useDateRange()
  const { data: meta } = useCategorizeMeta()
  const {
    data: queueData,
    isPending,
    isError,
    refetch,
  } = useCategorizeGroupedQueue(committedRange.start, committedRange.end)
  const { data: normalizedData } = useNormalizedTransactions(
    committedRange.start,
    committedRange.end,
  )
  const fireflyBaseUrl = normalizedData?.firefly_base_url

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [cardState, setCardState] = useState<Record<string, CardState>>({})
  const [suggesting, setSuggesting] = useState(false)
  const [suggestProgress, setSuggestProgress] = useState({ done: 0, total: 0 })
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [ignoringId, setIgnoringId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [creatingRuleId, setCreatingRuleId] = useState<string | null>(null)
  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({})

  const visibleGroups = useMemo(() => {
    const groups = (queueData?.data ?? []) as PendingGroup[]
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => !dismissedIds.has(row.journal_id)),
      }))
      .filter((group) => group.rows.length > 0)
  }, [queueData?.data, dismissedIds])

  const visibleRows = useMemo(
    () => visibleGroups.flatMap((group) => group.rows),
    [visibleGroups],
  )

  const openrouterConfigured = meta?.openrouter_configured ?? false

  function dismissJournalIds(ids: string[]) {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        next.add(id)
      }
      return next
    })
  }

  async function invalidateAfterApply() {
    await Promise.all([
      invalidateReportCaches(queryClient),
      queryClient.invalidateQueries({ queryKey: ["categorizeQueue"] }),
    ])
  }

  async function handleSuggest() {
    if (!openrouterConfigured || visibleRows.length === 0) return
    setSuggesting(true)
    setSuggestError(null)
    const journalIds = visibleRows.map((r) => r.journal_id)
    setSuggestProgress({ done: 0, total: journalIds.length })
    try {
      const allItems: SuggestResultItem[] = []
      for (let i = 0; i < journalIds.length; i += SUGGEST_CHUNK_SIZE) {
        const chunk = journalIds.slice(i, i + SUGGEST_CHUNK_SIZE)
        const result = await suggestCategorizations({
          start: committedRange.start,
          end: committedRange.end,
          journal_ids: chunk,
        })
        allItems.push(...result.data)
        setSuggestProgress({ done: allItems.length, total: journalIds.length })
      }
      const categories = meta?.categories ?? []
      const budgets = meta?.budgets ?? []
      setCardState((prev) => {
        const next: Record<string, CardState> = { ...prev }
        for (const item of allItems) {
          const row = visibleRows.find((r) => r.journal_id === item.journal_id)
          const categoryId =
            item.suggestion != null
              ? (categories.find((c) => c.name === item.suggestion?.category)?.id ??
                "")
              : ""
          const budgetId =
            item.suggestion?.budget != null
              ? (budgets.find((b) => b.name === item.suggestion?.budget)?.id ?? "")
              : ""
          next[item.journal_id] = {
            ...defaultCardState(item.suggestion ?? undefined, row),
            categoryId,
            budgetId,
            error: item.error,
          }
        }
        return next
      })
    } catch (err) {
      setSuggestError(
        err instanceof Error ? err.message : "Suggest failed. Try again.",
      )
    } finally {
      setSuggesting(false)
    }
  }

  async function handleApprove(row: PendingRow) {
    const state = cardState[row.journal_id]
    if (!state?.categoryId) return
    setApprovingId(row.journal_id)
    setApproveErrors((prev) => {
      const next = { ...prev }
      delete next[row.journal_id]
      return next
    })
    try {
      const applyDescription = effectiveApplyDescription(state, row)
      await applyCategorization(row.journal_id, {
        category_id: state.categoryId,
        transaction_journal_id: row.transaction_journal_id,
        budget_id: state.budgetId || null,
        description:
          applyDescription.trim() !== row.description.trim()
            ? applyDescription
            : null,
      })
      dismissJournalIds([row.journal_id])
      await invalidateAfterApply()
    } catch (err) {
      setApproveErrors((prev) => ({
        ...prev,
        [row.journal_id]:
          err instanceof Error ? err.message : "Apply failed. Try again.",
      }))
    } finally {
      setApprovingId(null)
    }
  }

  async function handlePreview(journalId: string) {
    const state = cardState[journalId]
    if (!state || !hasRuleTrigger(state)) return
    setPreviewingId(journalId)
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        preview: null,
        previewError: undefined,
      },
    }))
    try {
      const result = await previewRule({
        start: committedRange.start,
        end: committedRange.end,
        rule: ruleDraftFromState(state),
      })
      setCardState((prev) => ({
        ...prev,
        [journalId]: {
          ...prev[journalId],
          preview: result.data,
          previewError: undefined,
        },
      }))
    } catch (err) {
      setCardState((prev) => ({
        ...prev,
        [journalId]: {
          ...prev[journalId],
          preview: null,
          previewError:
            err instanceof Error ? err.message : "Preview failed. Try again.",
        },
      }))
    } finally {
      setPreviewingId(null)
    }
  }

  async function handleCreateRule(row: PendingRow, groupJournalIds: string[]) {
    const state = cardState[row.journal_id]
    if (!state?.categoryId || !state.preview) return
    setCreatingRuleId(row.journal_id)
    setCardState((prev) => ({
      ...prev,
      [row.journal_id]: { ...prev[row.journal_id], ruleError: undefined },
    }))
    try {
      const created = await createRule({
        start: committedRange.start,
        end: committedRange.end,
        category_id: state.categoryId,
        budget_id: state.budgetId || null,
        rule: ruleDraftFromState(state),
      })
      if (state.backfillOptIn) {
        try {
          await triggerRule(created.data.rule_id, {
            start: committedRange.start,
            end: committedRange.end,
          })
        } catch (triggerErr) {
          setCardState((prev) => ({
            ...prev,
            [row.journal_id]: {
              ...prev[row.journal_id],
              ruleError:
                triggerErr instanceof Error
                  ? `Rule created but backfill failed: ${triggerErr.message}`
                  : "Rule created but backfill failed. Try again from Firefly.",
            },
          }))
          return
        }
      }
      dismissJournalIds(groupJournalIds)
      await invalidateAfterApply()
    } catch (err) {
      setCardState((prev) => ({
        ...prev,
        [row.journal_id]: {
          ...prev[row.journal_id],
          ruleError:
            err instanceof Error ? err.message : "Rule create failed. Try again.",
        },
      }))
    } finally {
      setCreatingRuleId(null)
    }
  }

  async function handleIgnore(row: PendingRow) {
    setIgnoringId(row.journal_id)
    setApproveErrors((prev) => {
      const next = { ...prev }
      delete next[row.journal_id]
      return next
    })
    try {
      await ignoreCategorization(row.journal_id, {
        transaction_journal_id: row.transaction_journal_id,
      })
      dismissJournalIds([row.journal_id])
      await invalidateAfterApply()
    } catch (err) {
      setApproveErrors((prev) => ({
        ...prev,
        [row.journal_id]:
          err instanceof Error ? err.message : "Ignore failed. Try again.",
      }))
    } finally {
      setIgnoringId(null)
    }
  }

  function updateCategory(journalId: string, categoryId: string) {
    const row = visibleRows.find((r) => r.journal_id === journalId)
    if (!row) return
    setCardState((prev) => ({
      ...prev,
      [journalId]: ensureCardState(prev[journalId], row, { categoryId }),
    }))
  }

  function updateBudget(journalId: string, budgetId: string) {
    const row = visibleRows.find((r) => r.journal_id === journalId)
    if (!row) return
    setCardState((prev) => ({
      ...prev,
      [journalId]: ensureCardState(prev[journalId], row, { budgetId }),
    }))
  }

  function updateMode(journalId: string, mode: ApplyMode) {
    const row = visibleRows.find((r) => r.journal_id === journalId)
    if (!row) return
    setCardState((prev) => ({
      ...prev,
      [journalId]: ensureCardState(prev[journalId], row, { mode }),
    }))
  }

  function updateApplyDescription(journalId: string, value: string) {
    const row = visibleRows.find((r) => r.journal_id === journalId)
    if (!row) return
    setCardState((prev) => ({
      ...prev,
      [journalId]: ensureCardState(prev[journalId], row, {
        applyDescription: value,
      }),
    }))
  }

  function updateRuleTitle(journalId: string, title: string) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleTitle: title,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateRuleDescription(journalId: string, value: string) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleDescriptionContains: value,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateRuleDestination(journalId: string, value: string) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleDestinationAccount: value,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateRuleDestinationMatchType(
    journalId: string,
    value: DestinationMatchType,
  ) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleDestinationMatchType: value,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateRuleTransactionType(
    journalId: string,
    value: "" | "withdrawal" | "deposit",
  ) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleTransactionType: value,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateRuleAmount(journalId: string, value: string) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: {
        ...prev[journalId],
        ruleAmount: value,
        preview: null,
        previewError: undefined,
      },
    }))
  }

  function updateBackfill(journalId: string, checked: boolean) {
    setCardState((prev) => ({
      ...prev,
      [journalId]: { ...prev[journalId], backfillOptIn: checked },
    }))
  }

  function toggleGroup(fingerprint: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(fingerprint)) {
        next.delete(fingerprint)
      } else {
        next.add(fingerprint)
      }
      return next
    })
  }

  const categories = meta?.categories ?? []
  const budgets = meta?.budgets ?? []

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorize</h1>
          <p className="text-sm text-muted-foreground">
            {visibleRows.length} transaction
            {visibleRows.length === 1 ? "" : "s"} missing category or budget
          </p>
        </div>
        <div className="flex items-center gap-3">
          {suggesting && suggestProgress.total > 0 ? (
            <span className="text-sm text-muted-foreground">
              {suggestProgress.done} of {suggestProgress.total}
            </span>
          ) : null}
          {openrouterConfigured ? (
            <Button
              type="button"
              disabled={suggesting || visibleRows.length === 0}
              onClick={() => {
                void handleSuggest()
              }}
            >
              {suggesting ? "Suggesting…" : "Suggest categories"}
            </Button>
          ) : null}
        </div>
      </div>

      {suggestError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-medium">Could not fetch suggestions.</p>
          <p className="mt-1 text-sm text-muted-foreground">{suggestError}</p>
        </div>
      ) : null}

      {!openrouterConfigured && meta != null ? (
        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <strong className="text-foreground">AI suggestions unavailable.</strong>{" "}
            Configure <code className="text-xs">OPENROUTER_API_KEY</code> on the
            server to enable Suggest.
          </CardContent>
        </Card>
      ) : null}

      {isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-medium">Could not load queue.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void refetch()
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {isPending ? (
        <div className="space-y-6">
          {[0, 1].map((key) => (
            <Card key={key}>
              <CardHeader>
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-6 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!isPending && !isError ? (
        <Card className="border-muted bg-muted/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Filter, select, and bulk-update category or budget in Transaction
              Explorer — pre-filtered to this queue.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link
                to={buildCategorizeExplorerPath(
                  committedRange.start,
                  committedRange.end,
                )}
              >
                <Table className="mr-2 h-4 w-4" />
                Open in Explorer
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!isPending && !isError && visibleRows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <h2 className="text-lg font-semibold">Nothing to categorize</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            All withdrawals in this date range have both a category and a budget.
            Try widening the date range.
          </p>
        </div>
      ) : null}

      {!isPending && !isError && visibleRows.length > 0 ? (
        <div className="space-y-4">
          {visibleGroups.map((group) => {
            const isMulti = group.count > 1
            const expanded = expandedGroups.has(group.fingerprint)
            const primaryRow = group.rows[0]
            const groupJournalIds = group.rows.map((r) => r.journal_id)

            if (!isMulti) {
              return (
                <TransactionCard
                  key={primaryRow.journal_id}
                  row={primaryRow}
                  state={cardState[primaryRow.journal_id]}
                  categories={categories}
                  budgets={budgets}
                  fireflyBaseUrl={fireflyBaseUrl}
                  approvingId={approvingId}
                  previewingId={previewingId}
                  creatingRuleId={creatingRuleId}
                  approveErrors={approveErrors}
                  groupJournalIds={groupJournalIds}
                  onCategoryChange={updateCategory}
                  onBudgetChange={updateBudget}
                  onModeChange={updateMode}
                  onApplyDescriptionChange={updateApplyDescription}
                  onRuleTitleChange={updateRuleTitle}
                  onRuleDescriptionChange={updateRuleDescription}
                  onRuleDestinationChange={updateRuleDestination}
                  onRuleDestinationMatchTypeChange={updateRuleDestinationMatchType}
                  onRuleTransactionTypeChange={updateRuleTransactionType}
                  onRuleAmountChange={updateRuleAmount}
                  onBackfillChange={updateBackfill}
                  onApprove={handleApprove}
                  onPreview={handlePreview}
                  onCreateRule={handleCreateRule}
                  onIgnore={handleIgnore}
                  ignoringId={ignoringId}
                  rangeStart={committedRange.start}
                  rangeEnd={committedRange.end}
                />
              )
            }

            return (
              <div key={group.fingerprint} className="space-y-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-left"
                  onClick={() => {
                    toggleGroup(group.fingerprint)
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{group.sample_description}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.count} similar transactions
                    </p>
                  </div>
                  <Badge variant="secondary">{group.count} similar</Badge>
                </button>
                {expanded ? (
                  <div className="space-y-3 pl-2">
                    {group.rows.map((row) => (
                      <TransactionCard
                        key={row.journal_id}
                        row={row}
                        state={cardState[row.journal_id]}
                        categories={categories}
                        budgets={budgets}
                        fireflyBaseUrl={fireflyBaseUrl}
                        approvingId={approvingId}
                        previewingId={previewingId}
                        creatingRuleId={creatingRuleId}
                        approveErrors={approveErrors}
                        groupJournalIds={groupJournalIds}
                        onCategoryChange={updateCategory}
                        onBudgetChange={updateBudget}
                        onModeChange={updateMode}
                        onApplyDescriptionChange={updateApplyDescription}
                        onRuleTitleChange={updateRuleTitle}
                        onRuleDescriptionChange={updateRuleDescription}
                        onRuleDestinationChange={updateRuleDestination}
                  onRuleDestinationMatchTypeChange={updateRuleDestinationMatchType}
                        onRuleTransactionTypeChange={updateRuleTransactionType}
                        onRuleAmountChange={updateRuleAmount}
                        onBackfillChange={updateBackfill}
                        onApprove={handleApprove}
                        onPreview={handlePreview}
                        onCreateRule={handleCreateRule}
                        onIgnore={handleIgnore}
                  ignoringId={ignoringId}
                  rangeStart={committedRange.start}
                  rangeEnd={committedRange.end}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
