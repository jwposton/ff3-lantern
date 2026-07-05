import { useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { Pencil, Plus } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { BillGroupSheet } from "@/components/payment-run/BillGroupSheet"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { registeredBillsQueryKey } from "@/hooks/useBillHistory"
import { useHealth } from "@/hooks/useHealth"
import { paymentRunQueryKey } from "@/hooks/usePaymentWorksheet"
import {
  billGroupsQueryKey,
  createBillGroup,
  currentMonthKey,
  deleteBillGroup,
  fetchBillGroups,
  fetchRegisteredBills,
  patchBillGroup,
  type BillGroup,
} from "@/lib/paymentRunApi"

export function BillGroupsPage() {
  const month = currentMonthKey()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  const { data: health, isPending: healthPending } = useHealth()
  const { data: groupsData, isPending: groupsPending } = useQuery({
    queryKey: billGroupsQueryKey(),
    queryFn: fetchBillGroups,
  })
  const { data: registeredData, isPending: registeredPending } = useQuery({
    queryKey: registeredBillsQueryKey(),
    queryFn: fetchRegisteredBills,
  })
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<BillGroup | null>(null)

  const eligibleBills = useMemo(
    () =>
      (registeredData?.data ?? []).filter(
        (bill) =>
          bill.worksheet_section === "bills" ||
          bill.worksheet_section === "liabilities",
      ),
    [registeredData],
  )

  const groups = groupsData?.data ?? []
  const isPending = groupsPending || registeredPending

  if (!healthPending && health && !health.payment_worksheet_enabled) {
    return <Navigate to="/" replace />
  }

  async function invalidateBillGroupCaches() {
    await queryClient.invalidateQueries({ queryKey: paymentRunQueryKey(month) })
    await queryClient.invalidateQueries({ queryKey: billGroupsQueryKey() })
    await queryClient.invalidateQueries({ queryKey: registeredBillsQueryKey() })
  }

  async function handleSaveGroup(values: {
    id?: string
    label: string
    sort_order: number
    member_ids: number[]
  }) {
    if (values.id) {
      await patchBillGroup(values.id, {
        label: values.label,
        sort_order: values.sort_order,
        member_ids: values.member_ids,
      })
    } else {
      await createBillGroup({
        label: values.label,
        sort_order: values.sort_order,
      })
    }
    await invalidateBillGroupCaches()
  }

  async function handleDeleteGroup(groupId: string) {
    await deleteBillGroup(groupId)
    await invalidateBillGroupCaches()
  }

  function openAddGroup() {
    setEditingGroup(null)
    setGroupSheetOpen(true)
  }

  async function openEditGroup(groupId: string) {
    const { data: freshGroups } = await fetchBillGroups()
    const full = freshGroups.find((row) => row.id === groupId) ?? null
    setEditingGroup(full)
    setGroupSheetOpen(true)
  }

  useEffect(() => {
    const groupParam = searchParams.get("group")
    if (!groupParam || deepLinkHandled.current || groups.length === 0) return
    const match = groups.find((group) => group.id === groupParam)
    if (!match) return
    deepLinkHandled.current = true
    void openEditGroup(match.id)
  }, [groups, searchParams])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bill groups</h1>
          <p className="text-muted-foreground text-sm">
            Group related bills and liabilities for collapsible rollups on the{" "}
            <Link
              to="/manage/payment-run"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              payment worksheet
            </Link>
            .
          </p>
        </div>
        <Button type="button" onClick={openAddGroup}>
          <Plus className="mr-2 size-4" />
          Add group
        </Button>
      </div>

      {isPending || healthPending ? (
        <Skeleton className="h-32 w-full" />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">
              No bill groups yet. Click{" "}
              <span className="font-medium text-foreground">Add group</span> to
              create one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{group.label}</p>
                <p className="text-muted-foreground text-xs">
                  {group.member_count === 1
                    ? "1 member"
                    : `${group.member_count} members`}
                  {group.visible_count !== group.member_count
                    ? ` · ${group.visible_count} visible on worksheet`
                    : null}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Edit ${group.label}`}
                onClick={() => void openEditGroup(group.id)}
              >
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <BillGroupSheet
        open={groupSheetOpen}
        onOpenChange={setGroupSheetOpen}
        group={editingGroup}
        eligibleBills={eligibleBills}
        onSave={handleSaveGroup}
        onDelete={handleDeleteGroup}
      />
    </div>
  )
}
