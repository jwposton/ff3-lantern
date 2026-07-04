import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useCategorizeMeta } from "@/hooks/useCategorizeMeta"
import {
  fetchBillLinkRules,
  type AvailableFireflyBill,
  type BillLinkRule,
  type CreditCardRow,
  type FundingBucketRollup,
  type RegisterBillPayload,
} from "@/lib/paymentRunApi"

type RegistrationMode = "create_new" | "link_existing"

export type BillRegistrationEditTarget = {
  registryId: number
  row_label: string | null
  worksheet_section: string
  payment_rail: string
  funding_bucket_key: string | null
  credit_card_account_id: string | null
  amount_mode: string
}

type BillRegistrationSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultSection?: "bills" | "liabilities"
  initialMode?: RegistrationMode
  initialFireflyBillId?: string | null
  editTarget?: BillRegistrationEditTarget | null
  creditCards: CreditCardRow[]
  buckets: FundingBucketRollup[]
  availableBills: AvailableFireflyBill[]
  loadingAvailable?: boolean
  onSubmit: (payload: RegisterBillPayload) => Promise<void>
}

const selectClassName =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-hidden"

export function BillRegistrationSheet({
  open,
  onOpenChange,
  defaultSection = "bills",
  initialMode = "create_new",
  initialFireflyBillId = null,
  editTarget = null,
  creditCards,
  buckets,
  availableBills,
  loadingAvailable = false,
  onSubmit,
}: BillRegistrationSheetProps) {
  const [mode, setMode] = useState<RegistrationMode>("create_new")
  const [name, setName] = useState("")
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [amountMode, setAmountMode] = useState<"recurring" | "intermittent">(
    "recurring",
  )
  const [repeatFreq, setRepeatFreq] = useState("monthly")
  const [worksheetSection, setWorksheetSection] = useState<
    "bills" | "liabilities"
  >(defaultSection)
  const [paymentRail, setPaymentRail] = useState<"bank" | "credit_card">("bank")
  const [fundingBucketKey, setFundingBucketKey] = useState("")
  const [creditCardAccountId, setCreditCardAccountId] = useState("")
  const [descriptionContains, setDescriptionContains] = useState("")
  const [payeeContains, setPayeeContains] = useState("")
  const [categoryName, setCategoryName] = useState("")
  const [amountExactly, setAmountExactly] = useState("")
  const [selectedBillId, setSelectedBillId] = useState("")
  const [selectedRuleId, setSelectedRuleId] = useState("")
  const [linkRules, setLinkRules] = useState<BillLinkRule[]>([])
  const [loadingLinkRules, setLoadingLinkRules] = useState(false)
  const [linkRulesError, setLinkRulesError] = useState<string | null>(null)
  const [useExistingRule, setUseExistingRule] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: categorizeMeta } = useCategorizeMeta()
  const categories = categorizeMeta?.categories ?? []

  const isEditMode = editTarget !== null

  useEffect(() => {
    if (!open) return
    if (editTarget) {
      setMode("create_new")
      setName(editTarget.row_label ?? "")
      setAmountMin("")
      setAmountMax("")
      setAmountMode(
        editTarget.amount_mode === "intermittent" ? "intermittent" : "recurring",
      )
      setRepeatFreq("monthly")
      setWorksheetSection(
        editTarget.worksheet_section === "liabilities" ? "liabilities" : "bills",
      )
      setPaymentRail(
        editTarget.payment_rail === "credit_card" ? "credit_card" : "bank",
      )
      setFundingBucketKey(editTarget.funding_bucket_key ?? buckets[0]?.id ?? "")
      setCreditCardAccountId(
        editTarget.credit_card_account_id ?? creditCards[0]?.account_id ?? "",
      )
      setDescriptionContains("existing-rule")
      setPayeeContains("")
      setCategoryName("")
      setAmountExactly("")
      setSelectedBillId("")
      setSelectedRuleId("")
      setLinkRules([])
      setUseExistingRule(false)
      setError(null)
      return
    }
    setMode(initialMode)
    setName("")
    setAmountMin("")
    setAmountMax("")
    setAmountMode("recurring")
    setRepeatFreq("monthly")
    setWorksheetSection(defaultSection)
    setPaymentRail("bank")
    setFundingBucketKey(buckets[0]?.id ?? "")
    setCreditCardAccountId(creditCards[0]?.account_id ?? "")
    setDescriptionContains("")
    setPayeeContains("")
    setCategoryName("")
    setAmountExactly("")
    setSelectedBillId(initialFireflyBillId ?? "")
    setSelectedRuleId("")
    setLinkRules([])
    setUseExistingRule(false)
    setError(null)
  }, [
    open,
    defaultSection,
    initialMode,
    initialFireflyBillId,
    editTarget,
    buckets,
    creditCards,
  ])

  useEffect(() => {
    if (!selectedBillId) return
    const bill = availableBills.find((row) => row.id === selectedBillId)
    if (!bill) return
    setName(bill.name ?? "")
    setAmountMin(bill.amount_min ?? "")
    setAmountMax(bill.amount_max ?? bill.amount_min ?? "")
    setRepeatFreq(bill.repeat_freq ?? "monthly")
  }, [selectedBillId, availableBills])

  useEffect(() => {
    if (!open || isEditMode || mode !== "link_existing" || !selectedBillId) {
      setLinkRules([])
      setSelectedRuleId("")
      setUseExistingRule(false)
      setLinkRulesError(null)
      return
    }

    let cancelled = false
    setLoadingLinkRules(true)
    setLinkRulesError(null)
    void fetchBillLinkRules(selectedBillId)
      .then(({ data }) => {
        if (cancelled) return
        setLinkRules(data)
        if (data.length > 0) {
          const first = data[0]
          setSelectedRuleId(first.id)
          setUseExistingRule(true)
          setDescriptionContains(first.description_contains ?? "")
          setPayeeContains(first.payee_contains ?? "")
          setCategoryName(first.category_name ?? "")
          setAmountExactly(first.amount_exactly ?? "")
        } else {
          setSelectedRuleId("")
          setUseExistingRule(false)
          setDescriptionContains("")
          setPayeeContains("")
          setCategoryName("")
          setAmountExactly("")
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLinkRules([])
        setSelectedRuleId("")
        setUseExistingRule(false)
        setLinkRulesError(
          err instanceof Error
            ? err.message
            : "Could not load matching rules for this bill.",
        )
      })
      .finally(() => {
        if (!cancelled) setLoadingLinkRules(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, isEditMode, mode, selectedBillId])

  function applyLinkRule(rule: BillLinkRule) {
    setSelectedRuleId(rule.id)
    setDescriptionContains(rule.description_contains ?? "")
    setPayeeContains(rule.payee_contains ?? "")
    setCategoryName(rule.category_name ?? "")
    setAmountExactly(rule.amount_exactly ?? "")
  }

  function switchToNewRule() {
    setUseExistingRule(false)
    setSelectedRuleId("")
    setDescriptionContains("")
    setPayeeContains("")
    setCategoryName("")
    setAmountExactly("")
  }

  function mirrorAmountOnBlur(field: "min" | "max") {
    if (field === "min") {
      const trimmed = amountMin.trim()
      if (trimmed && !amountMax.trim()) setAmountMax(trimmed)
      return
    }
    const trimmed = amountMax.trim()
    if (trimmed && !amountMin.trim()) setAmountMin(trimmed)
  }

  async function handleSubmit() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("Bill name is required.")
      return
    }
    const trimmedRule = descriptionContains.trim()
    const trimmedPayee = payeeContains.trim()
    const trimmedCategory = categoryName.trim()
    const ruleId =
      mode === "link_existing" && useExistingRule && selectedRuleId
        ? selectedRuleId
        : null
    if (
      !isEditMode &&
      !ruleId &&
      !trimmedRule &&
      !trimmedPayee &&
      !trimmedCategory
    ) {
      setError(
        "Select or create a matching rule — at least payee, description, or category is required.",
      )
      return
    }
    if (mode === "link_existing" && !selectedBillId) {
      setError("Select a Firefly bill to link.")
      return
    }
    if (paymentRail === "bank" && !fundingBucketKey) {
      setError("Funding bucket is required for bank account payments.")
      return
    }
    if (paymentRail === "credit_card" && !creditCardAccountId) {
      setError("Credit card is required when payment rail is credit card.")
      return
    }
    const trimmedAmountMin = amountMin.trim()
    const trimmedAmountMax = amountMax.trim()
    if (
      amountMode === "recurring" &&
      !trimmedAmountMin &&
      !trimmedAmountMax
    ) {
      setError("Amount min or max is required for recurring bills.")
      return
    }

    const payload: RegisterBillPayload = {
      mode,
      name: trimmedName,
      amount_min: trimmedAmountMin || undefined,
      amount_max: trimmedAmountMax || undefined,
      amount_mode: amountMode,
      repeat_freq: repeatFreq,
      worksheet_section: worksheetSection,
      payment_rail: paymentRail,
      funding_bucket_key:
        paymentRail === "bank" ? fundingBucketKey || null : null,
      credit_card_account_id:
        paymentRail === "credit_card" ? creditCardAccountId || null : null,
      description_contains: trimmedRule,
      destination_account: trimmedPayee,
      category_name: trimmedCategory,
      amount_exactly: amountExactly.trim() || null,
      firefly_bill_id: mode === "link_existing" ? selectedBillId : null,
      rule_id: ruleId,
    }

    setSaving(true)
    setError(null)
    try {
      await onSubmit(payload)
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not register bill. Check Firefly connection and try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = isEditMode
    ? "Save registration"
    : mode === "create_new"
      ? "Register bill"
      : "Link to worksheet"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {isEditMode ? "Edit bill registration" : "Register a bill"}
          </SheetTitle>
          <SheetDescription>
            A matching rule is required so imports link to this bill.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto px-4">
          {!isEditMode ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "create_new" ? "default" : "outline"}
                aria-pressed={mode === "create_new"}
                onClick={() => setMode("create_new")}
              >
                Create new
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "link_existing" ? "default" : "outline"}
                aria-pressed={mode === "link_existing"}
                onClick={() => setMode("link_existing")}
              >
                Link existing
              </Button>
            </div>
          ) : null}

          {mode === "link_existing" ? (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ff-bill">
                Firefly bill
              </label>
              <p className="text-muted-foreground text-xs">
                Only subscriptions not already on this worksheet. Cache clear does
                not affect this list — it loads live from Firefly.
              </p>
              {loadingAvailable ? (
                <p className="text-muted-foreground text-sm">Loading bills…</p>
              ) : availableBills.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No unregistered Firefly bills found. Switch to{" "}
                  <span className="font-medium">Create new</span> or add bills in
                  Firefly first.
                </p>
              ) : (
                <select
                  id="ff-bill"
                  className={selectClassName}
                  value={selectedBillId}
                  onChange={(event) => setSelectedBillId(event.target.value)}
                >
                  <option value="">Select a bill…</option>
                  {availableBills.map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      {bill.name ?? bill.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="bill-name">
              Bill name
            </label>
            <Input
              id="bill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="bill-amount-min">
                Amount min
                {amountMode === "intermittent" ? " (optional)" : ""}
              </label>
              <Input
                id="bill-amount-min"
                inputMode="decimal"
                value={amountMin}
                onChange={(event) => setAmountMin(event.target.value)}
                onBlur={() => mirrorAmountOnBlur("min")}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="bill-amount-max">
                Amount max
                {amountMode === "intermittent" ? " (optional)" : ""}
              </label>
              <Input
                id="bill-amount-max"
                inputMode="decimal"
                value={amountMax}
                onChange={(event) => setAmountMax(event.target.value)}
                onBlur={() => mirrorAmountOnBlur("max")}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {amountMode === "recurring"
              ? "Set one or both — a single value applies to min and max. Worksheet owed uses the average when they differ."
              : "Optional Firefly bill range — leave both blank for fully variable bills; worksheet planned starts at $0."}
          </p>

          <div className="space-y-1">
            <span className="text-sm font-medium">Amount mode</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={amountMode === "recurring" ? "default" : "outline"}
                aria-pressed={amountMode === "recurring"}
                onClick={() => setAmountMode("recurring")}
              >
                Recurring
              </Button>
              <Button
                type="button"
                size="sm"
                variant={amountMode === "intermittent" ? "default" : "outline"}
                aria-pressed={amountMode === "intermittent"}
                onClick={() => setAmountMode("intermittent")}
              >
                Intermittent
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {amountMode === "recurring"
                ? "Fixed monthly amount from the Firefly bill."
                : "Starts at $0 each month until you enter an amount."}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="bill-repeat">
              Repeat
            </label>
            <select
              id="bill-repeat"
              className={selectClassName}
              value={repeatFreq}
              onChange={(event) => setRepeatFreq(event.target.value)}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="bill-section">
              Worksheet section
            </label>
            <select
              id="bill-section"
              className={selectClassName}
              value={worksheetSection}
              onChange={(event) =>
                setWorksheetSection(event.target.value as "bills" | "liabilities")
              }
            >
              <option value="bills">Bills</option>
              <option value="liabilities">Liabilities</option>
            </select>
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">Payment rail</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={paymentRail === "bank" ? "default" : "outline"}
                aria-pressed={paymentRail === "bank"}
                onClick={() => setPaymentRail("bank")}
              >
                Bank account
              </Button>
              <Button
                type="button"
                size="sm"
                variant={paymentRail === "credit_card" ? "default" : "outline"}
                aria-pressed={paymentRail === "credit_card"}
                onClick={() => setPaymentRail("credit_card")}
              >
                Credit card
              </Button>
            </div>
            {paymentRail === "credit_card" ? (
              <p className="text-muted-foreground text-xs">
                Charge lands on the card; plan paydown in Credit cards. This row
                won&apos;t count toward bucket cash.
              </p>
            ) : null}
          </div>

          {paymentRail === "bank" ? (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="bill-bucket">
                Funding bucket
              </label>
              <select
                id="bill-bucket"
                className={selectClassName}
                value={fundingBucketKey}
                onChange={(event) => setFundingBucketKey(event.target.value)}
              >
                <option value="">Select bucket…</option>
                {buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="bill-card">
                Credit card
              </label>
              <select
                id="bill-card"
                className={selectClassName}
                value={creditCardAccountId}
                onChange={(event) =>
                  setCreditCardAccountId(event.target.value)
                }
              >
                <option value="">Select card…</option>
                {creditCards.map((card) => (
                  <option key={card.account_id} value={card.account_id}>
                    {card.name ?? card.account_id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isEditMode ? (
            <>
              {mode === "link_existing" && selectedBillId ? (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Matching rule</span>
                  {loadingLinkRules ? (
                    <p className="text-muted-foreground text-sm">
                      Loading existing rules…
                    </p>
                  ) : linkRulesError ? (
                    <p className="text-destructive text-sm">{linkRulesError}</p>
                  ) : linkRules.length > 0 ? (
                    <>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={useExistingRule ? "default" : "outline"}
                          aria-pressed={useExistingRule}
                          onClick={() => {
                            setUseExistingRule(true)
                            const rule =
                              linkRules.find((row) => row.id === selectedRuleId) ??
                              linkRules[0]
                            applyLinkRule(rule)
                          }}
                        >
                          Use existing rule
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={!useExistingRule ? "default" : "outline"}
                          aria-pressed={!useExistingRule}
                          onClick={switchToNewRule}
                        >
                          Create new rule
                        </Button>
                      </div>
                      {useExistingRule ? (
                        <select
                          id="existing-rule"
                          className={selectClassName}
                          value={selectedRuleId}
                          onChange={(event) => {
                            const rule = linkRules.find(
                              (row) => row.id === event.target.value,
                            )
                            if (rule) applyLinkRule(rule)
                          }}
                        >
                          {linkRules.map((rule) => (
                            <option key={rule.id} value={rule.id}>
                              {rule.title ?? rule.id}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No Firefly rule links this bill yet — define triggers below
                      to create one.
                    </p>
                  )}
                </div>
              ) : null}

              {!(mode === "link_existing" && useExistingRule) ? (
                <>
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="rule-payee">
                      Rule — payee contains
                    </label>
                    <Input
                      id="rule-payee"
                      value={payeeContains}
                      onChange={(event) => setPayeeContains(event.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      Matches the expense payee (destination account) on withdrawals.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="rule-description">
                      Rule — description contains
                    </label>
                    <Input
                      id="rule-description"
                      value={descriptionContains}
                      onChange={(event) =>
                        setDescriptionContains(event.target.value)
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      At least one of payee, description, or category is required
                      so imports link to this bill.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="rule-category">
                      Rule — category is
                    </label>
                    <select
                      id="rule-category"
                      className={selectClassName}
                      value={categoryName}
                      onChange={(event) => setCategoryName(event.target.value)}
                    >
                      <option value="">— None —</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-foreground text-xs">
                      Matches withdrawals already categorized with this name.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="rule-amount">
                      Rule — amount exactly (optional)
                    </label>
                    <Input
                      id="rule-amount"
                      inputMode="decimal"
                      value={amountExactly}
                      onChange={(event) => setAmountExactly(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="bg-muted/40 space-y-1 rounded-md border p-3 text-sm">
                  {payeeContains ? (
                    <p>
                      <span className="font-medium">Payee contains:</span>{" "}
                      {payeeContains}
                    </p>
                  ) : null}
                  {categoryName ? (
                    <p>
                      <span className="font-medium">Category is:</span>{" "}
                      {categoryName}
                    </p>
                  ) : null}
                  <p>
                    <span className="font-medium">Description contains:</span>{" "}
                    {descriptionContains || "—"}
                  </p>
                  {amountExactly ? (
                    <p>
                      <span className="font-medium">Amount exactly:</span>{" "}
                      {amountExactly}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Reusing the existing Firefly rule — no new rule will be created.
                  </p>
                </div>
              )}
            </>
          ) : null}

          <p className="text-muted-foreground text-sm">
            {worksheetSection === "bills" ? "Bills" : "Liabilities"} ·{" "}
            {paymentRail === "bank" ? "Bank account" : "Credit card"} ·{" "}
            {trimmedNamePreview(name) || "New bill"}
          </p>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Close without saving
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? "Saving…" : submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function trimmedNamePreview(name: string): string {
  return name.trim()
}
