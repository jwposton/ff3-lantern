import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseExplorerFilter } from "@/lib/transactionsApi"
import { normalizeAiParsedFilter } from "@/lib/explorerFilterUrl"
import type { FilterState } from "@/lib/transactionTable"

type FilterAiInputProps = {
  start: string
  end: string
  filterParseModel?: string
  disabled?: boolean
  onApplyFilter: (filter: FilterState, rationale: string) => void
}

export function FilterAiInput({
  start,
  end,
  filterParseModel,
  disabled = false,
  onApplyFilter,
}: FilterAiInputProps) {
  const [query, setQuery] = useState("")
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rationale, setRationale] = useState<string | null>(null)

  async function handleParse() {
    const trimmed = query.trim()
    if (!trimmed) return
    setParsing(true)
    setError(null)
    setRationale(null)
    try {
      const result = await parseExplorerFilter({
        query: trimmed,
        start,
        end,
      })
      onApplyFilter(
        normalizeAiParsedFilter(result.data.filter, trimmed),
        result.data.rationale,
      )
      setRationale(result.data.rationale)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Filter parse failed")
    } finally {
      setParsing(false)
    }
  }

  return (
    <details className="rounded-md border border-dashed p-2">
      <summary className="cursor-pointer text-sm font-medium">
        Describe what you&apos;re looking for…
      </summary>
      <div className="mt-3 space-y-2">
        {filterParseModel ? (
          <p className="text-xs text-muted-foreground">
            Model: <code className="text-xs">{filterParseModel}</code>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Input
            value={query}
            disabled={disabled || parsing}
            placeholder='e.g. "Amazon withdrawals from checking that are uncategorized"'
            className="h-9 min-w-[16rem] flex-1"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void handleParse()
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled || parsing || !query.trim()}
            onClick={() => {
              void handleParse()
            }}
          >
            {parsing ? "Parsing…" : "Parse filter"}
          </Button>
        </div>
        {rationale ? (
          <p className="text-xs text-muted-foreground">{rationale}</p>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  )
}
