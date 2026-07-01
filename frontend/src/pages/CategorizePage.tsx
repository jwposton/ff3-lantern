import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

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
  previewRule,
  suggestCategorizations,
  SUGGEST_CHUNK_SIZE,
  type SuggestResultItem,
  triggerRule,
  type PendingGroup,
  type PendingRow,
  type RuleDraft,
  type RulePreviewCounts,
  type SuggestionPayload,
  type DestinationMatchType,
} from "@/lib/categorizeApi"
import { invalidateReportCaches } from "@/lib/reportCache"
import { cn } from "@/lib/utils"

type ApplyMode = "direct" | "rule"

type CardState = {
  suggestion?: SuggestionPayload
  categoryId: string
  budgetId: string
  error?: string
  mode: ApplyMode
  ruleTitle: string
  ruleDescriptionContains: string
  ruleDestinationAccount: string
  ruleDestinationMatchType: DestinationMatchType
  ruleTransactionType: "" | "withdrawal" | "deposit"
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

function ruleDraftFromState(state: CardState): RuleDraft {
  const txType = state.ruleTransactionType
  return {
    title: state.ruleTitle ?? "",
    description_contains: state.ruleDescriptionContains ?? "",
    destination_account: (state.ruleDestinationAccount ?? "").trim() || null,
    destination_match_type: state.ruleDestinationMatchType ?? "is",
    transaction_type:
      txType === "withdrawal" || txType === "deposit" ? txType : null,
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
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
}

function inputClassName(): string {
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
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
    ruleTitle: suggestion?.rule?.title ?? "",
    ruleDescriptionContains: suggestion?.rule?.description_contains ?? "",
    ruleDestinationAccount:
      suggestion?.rule?.destination_account ?? row?.destination_name ?? "",
    ruleDestinationMatchType:
      suggestion?.rule?.destination_match_type ?? "is",
    ruleTransactionType: suggestion?.rule?.transaction_type ?? rowType,
    preview: null,
    backfillOptIn: false,
  }
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
  onRuleTitleChange,
  onRuleDescriptionChange,
  onRuleDestinationChange,
  onRuleDestinationMatchTypeChange,
  onRuleTransactionTypeChange,
  onBackfillChange,
  onApprove,
  onPreview,
  onCreateRule,
  onSkip,
  groupJournalIds,
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
  onBackfillChange: (journalId: string, checked: boolean) => void
  onApprove: (row: PendingRow) => void
  onPreview: (journalId: string) => void
  onCreateRule: (row: PendingRow, groupJournalIds: string[]) => void
  onSkip: (journalId: string) => void
  groupJournalIds: string[]
}) {
  const mode = state?.mode ?? "direct"
  const previewReady = state?.preview != null && !state.previewError

  return (
    <Card>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{row.date}</span>
          <div className="flex items-center gap-3">
            <FireflyTransactionLink
              fireflyBaseUrl={fireflyBaseUrl}
                        journalId={row.journal_id}
            />
            <span className="font-medium">{row.amount}</span>
          </div>
        </div>
        <p className="truncate text-sm font-medium" title={row.description}>
          {row.description}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.source_name} → {row.destination_name}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {state?.suggestion?.rationale ? (
          <p className="text-sm text-muted-foreground">{state.suggestion.rationale}</p>
        ) : null}
        {state?.error ? (
          <p className="text-sm text-destructive">
            {state.error.includes("allowlist")
              ? "Category not recognized. Pick from the dropdown."
              : "Suggestion failed for this transaction."}
          </p>
        ) : null}
        {approveErrors[row.journal_id] ? (
          <p className="text-sm text-destructive">{approveErrors[row.journal_id]}</p>
        ) : null}
        {state?.ruleError ? (
          <p className="text-sm text-destructive">{state.ruleError}</p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "direct" ? "default" : "outline"}
            onClick={() => {
              onModeChange(row.journal_id, "direct")
            }}
          >
            Apply to transaction
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "rule" ? "default" : "outline"}
            onClick={() => {
              onModeChange(row.journal_id, "rule")
            }}
          >
            Rule mode
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium">
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
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium">
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
                "shrink-0",
                confidenceBadgeClass(state.suggestion.confidence),
              )}
            >
              {Math.round(state.suggestion.confidence * 100)}%
            </Badge>
          ) : null}
        </div>

        {mode === "rule" ? (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              Rule matches when every condition below is met. Use destination
              account (payee) when the bank description is generic.
            </p>
            <label className="flex flex-col gap-1 text-xs font-medium">
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
              <span className="font-normal text-muted-foreground">
                Bank statement text: &ldquo;{row.description}&rdquo;
              </span>
              <input
                className={inputClassName()}
                placeholder="e.g. AMZN MKTP (optional if payee is set)"
                value={state?.ruleDescriptionContains ?? ""}
                onChange={(e) => {
                  onRuleDescriptionChange(row.journal_id, e.target.value)
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Destination account (payee)
              <span className="font-normal text-muted-foreground">
                Firefly account on this transaction: {row.destination_name}
              </span>
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
                      ? "Exact Firefly account name"
                      : "Payee name fragment"
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!hasRuleTrigger(state) || previewingId === row.journal_id}
              onClick={() => {
                onPreview(row.journal_id)
              }}
            >
              {previewingId === row.journal_id ? "Previewing…" : "Preview matches"}
            </Button>
            {state?.previewError ? (
              <p className="text-sm text-destructive">{state.previewError}</p>
            ) : null}
            {state?.preview ? (
              <p className="text-sm text-muted-foreground">
                {state.preview.total} total · {state.preview.uncategorized_count}{" "}
                uncategorized · {state.preview.categorized_count} already categorized
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
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
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!state?.categoryId || approvingId === row.journal_id}
              onClick={() => {
                onApprove(row)
              }}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onSkip(row.journal_id)
              }}
            >
              Skip
            </Button>
          </div>
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
      await applyCategorization(row.journal_id, {
        category_id: state.categoryId,
        transaction_journal_id: row.transaction_journal_id,
        budget_id: state.budgetId || null,
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

  function handleSkip(journalId: string) {
    dismissJournalIds([journalId])
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
        <div className="space-y-6">
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
                  onRuleTitleChange={updateRuleTitle}
                  onRuleDescriptionChange={updateRuleDescription}
                  onRuleDestinationChange={updateRuleDestination}
                  onRuleDestinationMatchTypeChange={updateRuleDestinationMatchType}
                  onRuleTransactionTypeChange={updateRuleTransactionType}
                  onBackfillChange={updateBackfill}
                  onApprove={handleApprove}
                  onPreview={handlePreview}
                  onCreateRule={handleCreateRule}
                  onSkip={handleSkip}
                />
              )
            }

            return (
              <div key={group.fingerprint} className="space-y-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-left"
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
                  <div className="space-y-4 pl-2">
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
                        onRuleTitleChange={updateRuleTitle}
                        onRuleDescriptionChange={updateRuleDescription}
                        onRuleDestinationChange={updateRuleDestination}
                  onRuleDestinationMatchTypeChange={updateRuleDestinationMatchType}
                        onRuleTransactionTypeChange={updateRuleTransactionType}
                        onBackfillChange={updateBackfill}
                        onApprove={handleApprove}
                        onPreview={handlePreview}
                        onCreateRule={handleCreateRule}
                        onSkip={handleSkip}
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
