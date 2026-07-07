import { Navigate } from "react-router-dom"

/** Retired — Bill Pay hubs live in the sidebar group (#119). */
export function PaymentSetupPage() {
  return <Navigate to="/manage/payment-run" replace />
}
