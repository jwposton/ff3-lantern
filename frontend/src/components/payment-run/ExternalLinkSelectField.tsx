import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import {
  externalLinksQueryKey,
  fetchExternalLinks,
} from "@/lib/paymentRunApi"

const selectClassName =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"

type ExternalLinkSelectFieldProps = {
  value: string
  onChange: (id: string) => void
  id?: string
}

export function ExternalLinkSelectField({
  value,
  onChange,
  id = "external-link",
}: ExternalLinkSelectFieldProps) {
  const { data: linksData, isPending } = useQuery({
    queryKey: externalLinksQueryKey(),
    queryFn: fetchExternalLinks,
  })

  const links = [...(linksData?.data ?? [])].sort((a, b) =>
    a.label.localeCompare(b.label),
  )

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={id}>
        External link
      </label>
      <p className="text-muted-foreground text-xs">
        External bank or bill-pay login — not the Firefly transaction link.
      </p>
      {isPending ? (
        <p className="text-muted-foreground text-sm">Loading links…</p>
      ) : links.length === 0 ? (
        <>
          {value ? (
            <p className="text-muted-foreground text-sm">
              Assigned link no longer in catalog ({value}). Choose None to
              detach.
            </p>
          ) : null}
          <select
            id={id}
            className={selectClassName}
            disabled
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">None</option>
            {value ? (
              <option value={value} disabled>
                {value} (removed)
              </option>
            ) : null}
          </select>
          <p
            className="text-muted-foreground text-sm"
            data-testid="external-link-empty-catalog"
          >
            No external links yet. Create one in{" "}
            <Link
              to="/manage/payment-run/external-links"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              External links
            </Link>
            .
          </p>
        </>
      ) : (
        <select
          id={id}
          data-testid="external-link-select"
          className={selectClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">None</option>
          {links.map((link) => (
            <option key={link.id} value={link.id}>
              {link.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
