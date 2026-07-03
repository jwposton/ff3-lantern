/** OMNI row from GET /api/normalized_transactions (Phase 2 API). */
export type OmniRow = {
  amount: string | null
  type: string | null
  source_account: string | null
  source_type: string | null
  source_role: string | null
  destination_account: string | null
  destination_type: string | null
  destination_role: string | null
  budget: string | null
  category: string | null
  date: string
  description?: string | null
  /** Firefly transaction group id for /transactions/show/{id} */
  journal_id?: string | null
  /** Firefly split id for PUT updates */
  transaction_journal_id?: string | null
}
