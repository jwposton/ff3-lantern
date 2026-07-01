import { ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateRange } from "@/context/DateRangeContext"
import { useLoan, useLoanMeta } from "@/hooks/useLoans"
import { useNormalizedTransactions } from "@/hooks/useNormalizedTransactions"
import { buildFireflyAccountUrl } from "@/lib/fireflyLinks"
import {
  saveLoanProfile,
  type LoanAccountOption,
  type LoanProfile,
} from "@/lib/loanApi"

type SplitRole = "principal" | "interest" | "escrow"

function selectClassName(): string {
  return "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"
}

function defaultComponent(
  role: SplitRole,
  matchType: "transfer" | "withdrawal" = "transfer",
): LoanProfile["split"]["components"][number] {
  return {
    role,
    type: matchType,
    destination_account_id: "",
    destination_account: "",
    category: null,
    budget: null,
  }
}

function emptyProfile(): LoanProfile {
  return {
    version: 1,
    enabled: true,
    match: {
      type: "transfer",
      description_contains: "",
      expected_amount: "0.00",
      amount_tolerance: "0.50",
      max_per_month: 1,
    },
    split: {
      escrow_amount: "0.00",
      budget: null,
      components: [
        defaultComponent("principal"),
        defaultComponent("interest"),
        defaultComponent("escrow"),
      ],
    },
  }
}

function normalizeProfile(
  profile: LoanProfile,
  accountId: string,
  accountName: string,
): LoanProfile {
  const matchType = profile.match.type ?? "transfer"
  const roles: SplitRole[] = ["principal", "interest", "escrow"]
  const byRole = new Map(profile.split.components.map((c) => [c.role, c]))
  const components = roles.map((role) => {
    const existing = byRole.get(role) ?? defaultComponent(role, matchType)
    return {
      ...existing,
      role,
      type: matchType,
      category: existing.category ?? null,
      budget: existing.budget ?? null,
    }
  })
  const principal = components.find((c) => c.role === "principal")
  if (principal && !principal.destination_account_id) {
    principal.destination_account_id = accountId
    principal.destination_account = accountName
  }
  return {
    ...profile,
    split: {
      ...profile.split,
      budget: profile.split.budget ?? null,
      components,
    },
  }
}

function NameSelect({
  label,
  value,
  options,
  onChange,
  allowEmpty = true,
  emptyLabel = "None",
}: {
  label: string
  value: string | null | undefined
  options: LoanAccountOption[]
  onChange: (value: string | null) => void
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <select
        className={selectClassName()}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.name}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function LoanProfilePage() {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()
  const { committedRange } = useDateRange()
  const { data, isPending, isError } = useLoan(accountId)
  const { data: meta } = useLoanMeta()
  const { data: normalizedData } = useNormalizedTransactions(
    committedRange.start,
    committedRange.end,
  )
  const fireflyAccountUrl = buildFireflyAccountUrl(
    normalizedData?.firefly_base_url,
    accountId,
  )
  const [profile, setProfile] = useState<LoanProfile>(emptyProfile())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = meta?.categories ?? []
  const budgets = meta?.budgets ?? []
  const escrowAmount = parseFloat(profile.split.escrow_amount || "0")

  useEffect(() => {
    if (data?.profile) {
      setProfile(normalizeProfile(data.profile, accountId ?? "", data.name ?? ""))
    } else if (data && accountId) {
      setProfile(normalizeProfile(emptyProfile(), accountId, data.name ?? ""))
    }
  }, [data, accountId])

  function updateComponent(
    role: SplitRole,
    patch: Partial<LoanProfile["split"]["components"][number]>,
  ) {
    setProfile((prev) => ({
      ...prev,
      split: {
        ...prev.split,
        components: prev.split.components.map((comp) =>
          comp.role === role ? { ...comp, ...patch } : comp,
        ),
      },
    }))
  }

  async function handleSave() {
    if (!accountId) return
    setSaving(true)
    setError(null)
    try {
      await saveLoanProfile(accountId, profile)
      navigate("/manage/loans")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  if (isPending) return <Skeleton className="h-64 w-full max-w-2xl" />
  if (isError || !data) {
    return <p className="text-destructive text-sm">Failed to load loan profile.</p>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {fireflyAccountUrl ? (
            <a
              href={fireflyAccountUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:underline"
            >
              {data.name}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              <span className="sr-only"> — open account in Firefly</span>
            </a>
          ) : (
            data.name
          )}
        </h1>
        <p className="text-muted-foreground text-sm">Loan profile editor</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Match fingerprint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Match the imported lump payment <strong>before</strong> splitting. Check
            Transaction Explorer for the payment&apos;s Firefly type and description
            text.
          </p>
          <label className="block space-y-1 text-sm">
            <span>Transaction type</span>
            <select
              className={selectClassName()}
              value={profile.match.type ?? "transfer"}
              onChange={(e) => {
                const type = e.target.value as "transfer" | "withdrawal"
                setProfile({
                  ...profile,
                  match: {
                    ...profile.match,
                    type,
                  },
                  split: {
                    ...profile.split,
                    components: profile.split.components.map((comp) => ({
                      ...comp,
                      type,
                    })),
                  },
                })
              }}
            >
              <option value="transfer">transfer (checking → liability)</option>
              <option value="withdrawal">withdrawal (checking → expense payee)</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Description contains</span>
            <input
              className="border-input w-full rounded-md border px-3 py-2"
              value={profile.match.description_contains}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  match: { ...profile.match, description_contains: e.target.value },
                })
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Expected amount</span>
            <input
              className="border-input w-full rounded-md border px-3 py-2"
              value={profile.match.expected_amount}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  match: { ...profile.match, expected_amount: e.target.value },
                })
              }
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Amount tolerance</span>
            <input
              className="border-input w-full rounded-md border px-3 py-2"
              value={profile.match.amount_tolerance ?? "0.50"}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  match: { ...profile.match, amount_tolerance: e.target.value },
                })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(e) =>
                setProfile({ ...profile, enabled: e.target.checked })
              }
            />
            Enabled
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Split destinations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <NameSelect
            label="Default budget (all split lines)"
            value={profile.split.budget}
            options={budgets}
            onChange={(budget) =>
              setProfile({
                ...profile,
                split: { ...profile.split, budget },
              })
            }
          />

          <label className="block space-y-1 text-sm">
            <span>Escrow amount</span>
            <input
              className="border-input w-full rounded-md border px-3 py-2"
              value={profile.split.escrow_amount}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  split: { ...profile.split, escrow_amount: e.target.value },
                })
              }
            />
            <span className="text-muted-foreground text-xs">
              Escrow split line is created only when this amount is greater than 0.00.
            </span>
          </label>

          {profile.split.components.map((comp) => {
            const accountOptions =
              comp.role === "principal"
                ? (meta?.liability_accounts ?? [])
                : (meta?.expense_accounts ?? [])
            const optionalEscrow = comp.role === "escrow" && escrowAmount <= 0
            return (
              <div
                key={comp.role}
                className="space-y-3 rounded-md border border-border p-4"
              >
                <p className="font-medium capitalize">{comp.role}</p>
                <label className="block space-y-1 text-sm">
                  <span>
                    Destination account
                    {optionalEscrow ? " (optional until escrow > 0)" : ""}
                  </span>
                  <select
                    className={selectClassName()}
                    value={comp.destination_account_id}
                    onChange={(e) => {
                      const id = e.target.value
                      const name =
                        accountOptions.find((option) => option.id === id)?.name ?? ""
                      updateComponent(comp.role, {
                        destination_account_id: id,
                        destination_account: name,
                      })
                    }}
                  >
                    <option value="">Select account…</option>
                    {accountOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <NameSelect
                  label="Category"
                  value={comp.category}
                  options={categories}
                  onChange={(category) => updateComponent(comp.role, { category })}
                />
                <NameSelect
                  label="Budget override"
                  value={comp.budget}
                  options={budgets}
                  onChange={(budget) => updateComponent(comp.role, { budget })}
                  emptyLabel="Use default budget"
                />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {data.interest != null && (
        <p className="text-muted-foreground text-xs">
          Interest rate and balance come from this Firefly liability account (
          {data.interest}% rate, balance {data.current_balance ?? "—"}). Edit the
          account in Firefly to change them.
        </p>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          Save profile
        </Button>
        <Button asChild variant="outline">
          <Link to="/manage/loans">Cancel</Link>
        </Button>
      </div>
    </div>
  )
}
