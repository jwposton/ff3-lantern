import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDiscoverSettings,
  useUpdateDiscoverSettings,
} from "@/hooks/useDiscoverSettings"
import { cn } from "@/lib/utils"

export const discoverSelectClassName =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"

type DiscoverIgnoredCategoriesProps = {
  lookbackMonths?: number
  className?: string
}

export function DiscoverIgnoredCategories({
  lookbackMonths,
  className,
}: DiscoverIgnoredCategoriesProps) {
  const { data, isPending, isError } = useDiscoverSettings()
  const updateMutation = useUpdateDiscoverSettings(lookbackMonths)

  const ignored = data?.ignored_categories ?? []
  const available = data?.available_categories ?? []
  const ignoredFolded = new Set(ignored.map((name) => name.toLowerCase()))
  const addable = available.filter(
    (cat) => !ignoredFolded.has(cat.name.toLowerCase()),
  )

  function addSuggestedCategories() {
    const suggested = data?.suggested_ignored_categories ?? []
    if (!suggested.length) return
    const merged = [...ignored]
    const seen = new Set(ignored.map((name) => name.toLowerCase()))
    for (const name of suggested) {
      if (!seen.has(name.toLowerCase())) {
        merged.push(name)
        seen.add(name.toLowerCase())
      }
    }
    updateMutation.mutate({ ignored_categories: merged })
  }

  function addCategory(categoryName: string) {
    if (!categoryName || ignoredFolded.has(categoryName.toLowerCase())) return
    updateMutation.mutate({ ignored_categories: [...ignored, categoryName] })
  }

  function removeCategory(categoryName: string) {
    updateMutation.mutate({
      ignored_categories: ignored.filter(
        (name) => name.toLowerCase() !== categoryName.toLowerCase(),
      ),
    })
  }

  if (isPending) {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full max-w-md" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className={cn("text-destructive text-sm", className)}>
        Could not load ignored category settings.
      </p>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <p className="text-sm font-medium">Ignored categories</p>
        <p className="text-muted-foreground text-xs">
          Withdrawals in these categories are skipped when finding bill
          suggestions (e.g. Gas, Groceries, Restaurants).
        </p>
      </div>

      {ignored.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Ignored categories">
          {ignored.map((name) => (
            <li key={name}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {name}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  aria-label={`Remove ${name} from ignored categories`}
                  disabled={updateMutation.isPending}
                  onClick={() => removeCategory(name)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">No categories ignored.</p>
      )}

      {ignored.length === 0 &&
      (data?.suggested_ignored_categories?.length ?? 0) > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={updateMutation.isPending}
          onClick={addSuggestedCategories}
        >
          Add suggested excludes (Gas, Restaurants, …)
        </Button>
      ) : null}

      <div className="flex max-w-md flex-wrap items-center gap-2">
        <label htmlFor="discover-ignore-category" className="sr-only">
          Add ignored category
        </label>
        <select
          id="discover-ignore-category"
          className={cn(discoverSelectClassName, "max-w-xs flex-1")}
          defaultValue=""
          disabled={updateMutation.isPending || addable.length === 0}
          onChange={(event) => {
            const value = event.target.value
            if (!value) return
            addCategory(value)
            event.target.value = ""
          }}
        >
          <option value="">
            {addable.length === 0 ? "All categories selected" : "Add category…"}
          </option>
          {addable.map((cat) => (
            <option key={cat.id} value={cat.name}>
              {cat.name}
            </option>
          ))}
        </select>
        {updateMutation.isPending ? (
          <span className="text-muted-foreground text-xs">Saving…</span>
        ) : null}
      </div>
    </div>
  )
}
