import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FilterState } from "@/lib/transactionTable"
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
    })
  }

  return (
    <div className="sticky top-0 z-20 space-y-2 rounded-lg border bg-background p-3 shadow-sm">
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

        <Input
          type="search"
          placeholder="Search…"
          className="h-9 w-full min-w-[10rem] max-w-xs"
          value={filters.search}
          disabled={disabled}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showAllTypes}
            disabled={disabled}
            onChange={(e) => onShowAllTypesChange(e.target.checked)}
            className="rounded border"
          />
          Show all types
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
