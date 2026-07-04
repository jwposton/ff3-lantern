import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DestinationMatchType, FilterState } from "@/lib/transactionTable"
import { hasActiveFilters } from "@/lib/transactionTable"

export type FilterOptions = {
  categories: string[]
  budgets: string[]
  accounts: string[]
}

type TransactionFiltersProps = {
  filters: FilterState
  onChange: (filters: FilterState) => void
  options: FilterOptions
  showAllTypes: boolean
  onShowAllTypesChange: (value: boolean) => void
  disabled?: boolean
}

function filterSummary(filters: FilterState): string[] {
  const parts: string[] = []
  if (filters.categories.length > 0) {
    parts.push(`Category: ${filters.categories.join(", ")}`)
  }
  if (filters.budget) {
    parts.push(`Budget: ${filters.budget}`)
  }
  if (filters.account) {
    parts.push(`Account: ${filters.account}`)
  }
  if (filters.transaction_type) {
    parts.push(`Type: ${filters.transaction_type}`)
  }
  if (filters.description_contains.trim()) {
    parts.push(`Description contains: "${filters.description_contains.trim()}"`)
  }
  if (filters.destination_account.trim()) {
    parts.push(`Destination: ${filters.destination_account.trim()}`)
  }
  if (filters.amount_exact.trim()) {
    parts.push(`Amount: ${filters.amount_exact.trim()}`)
  } else {
    if (filters.amount_min.trim() && filters.amount_max.trim()) {
      parts.push(
        `Amount: ${filters.amount_min.trim()}–${filters.amount_max.trim()}`,
      )
    } else if (filters.amount_min.trim()) {
      parts.push(`Amount ≥ ${filters.amount_min.trim()}`)
    } else if (filters.amount_max.trim()) {
      parts.push(`Amount ≤ ${filters.amount_max.trim()}`)
    }
  }
  if (filters.uncategorized_only) {
    parts.push("Uncategorized only")
  }
  if (filters.categorize_queue_only) {
    parts.push("Categorize queue")
  }
  if (filters.search.trim()) {
    parts.push(`Search: "${filters.search.trim()}"`)
  }
  return parts
}

export function TransactionFilters({
  filters,
  onChange,
  options,
  showAllTypes,
  onShowAllTypesChange,
  disabled = false,
}: TransactionFiltersProps) {
  const active = hasActiveFilters(filters)

  function toggleCategory(category: string) {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category]
    onChange({ ...filters, categories: next })
  }

  function clearAll() {
    onChange({
      categories: [],
      budget: null,
      account: null,
      search: "",
      description_contains: "",
      destination_account: "",
      destination_match_type: "contains",
      transaction_type: null,
      amount_exact: "",
      amount_min: "",
      amount_max: "",
      uncategorized_only: false,
      categorize_queue_only: false,
    })
    onShowAllTypesChange(true)
  }

  return (
    <div className="space-y-2 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex min-h-12 flex-wrap items-center gap-2">
        <details className="relative">
          <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-input bg-transparent px-3 text-sm font-medium hover:bg-accent">
            Category
            {filters.categories.length > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {filters.categories.length}
              </Badge>
            ) : null}
          </summary>
          <div className="absolute left-0 z-30 mt-1 max-h-48 min-w-[12rem] overflow-auto rounded-md border bg-popover p-2 shadow-md">
            {options.categories.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No categories
              </p>
            ) : (
              options.categories.map((category) => (
                <label
                  key={category}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={filters.categories.includes(category)}
                    disabled={disabled}
                    onChange={() => toggleCategory(category)}
                    className="rounded border"
                  />
                  {category}
                </label>
              ))
            )}
          </div>
        </details>

        <select
          aria-label="Budget filter"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
          value={filters.budget ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...filters,
              budget: e.target.value === "" ? null : e.target.value,
            })
          }
        >
          <option value="">All budgets</option>
          {options.budgets.map((budget) => (
            <option key={budget} value={budget}>
              {budget}
            </option>
          ))}
        </select>

        <select
          aria-label="Source account filter"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
          value={filters.account ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...filters,
              account: e.target.value === "" ? null : e.target.value,
            })
          }
        >
          <option value="">All accounts</option>
          {options.accounts.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </select>

        <select
          aria-label="Transaction type filter"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
          value={filters.transaction_type ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...filters,
              transaction_type: e.target.value === "" ? null : e.target.value,
            })
          }
        >
          <option value="">All types</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="deposit">Deposit</option>
          <option value="transfer">Transfer</option>
        </select>

        <Input
          type="search"
          placeholder="Search all fields…"
          aria-label="Search all fields"
          className="h-9 w-full min-w-[10rem] max-w-xs"
          value={filters.search}
          disabled={disabled}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={!showAllTypes}
            disabled={disabled}
            onChange={(e) => onShowAllTypesChange(!e.target.checked)}
            className="rounded border"
          />
          Bank spending only
        </label>

        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={clearAll}
          >
            Clear all filters
          </Button>
        ) : null}
      </div>

      <details className="rounded-md border border-dashed p-2">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced filters
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Description contains
            <Input
              value={filters.description_contains}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...filters, description_contains: e.target.value })
              }
              className="h-9"
            />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Destination account
            <Input
              value={filters.destination_account}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...filters, destination_account: e.target.value })
              }
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Destination match
            <select
              aria-label="Destination match type"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
              value={filters.destination_match_type}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...filters,
                  destination_match_type: e.target.value as DestinationMatchType,
                })
              }
            >
              <option value="contains">Contains</option>
              <option value="starts_with">Starts with</option>
              <option value="ends_with">Ends with</option>
              <option value="is">Is</option>
            </select>
          </label>
          <label className="flex min-w-[8rem] flex-col gap-1 text-xs text-muted-foreground">
            Exact amount
            <Input
              inputMode="decimal"
              value={filters.amount_exact}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...filters,
                  amount_exact: e.target.value,
                  amount_min: "",
                  amount_max: "",
                })
              }
              className="h-9"
            />
          </label>
          <label className="flex min-w-[8rem] flex-col gap-1 text-xs text-muted-foreground">
            Min amount
            <Input
              inputMode="decimal"
              placeholder="≥"
              value={filters.amount_min}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...filters,
                  amount_min: e.target.value,
                  amount_exact: "",
                })
              }
              className="h-9"
            />
          </label>
          <label className="flex min-w-[8rem] flex-col gap-1 text-xs text-muted-foreground">
            Max amount
            <Input
              inputMode="decimal"
              placeholder="≤"
              value={filters.amount_max}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...filters,
                  amount_max: e.target.value,
                  amount_exact: "",
                })
              }
              className="h-9"
            />
          </label>
          <label className="flex h-9 items-center gap-2 self-end text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={filters.uncategorized_only}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...filters, uncategorized_only: e.target.checked })
              }
              className="rounded border"
            />
            Uncategorized only
          </label>
        </div>
      </details>

      {active ? (
        <div className="flex flex-wrap gap-1">
          {filterSummary(filters).map((label) => (
            <Badge key={label} variant="outline" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
