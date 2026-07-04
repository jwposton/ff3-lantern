import { Navigate } from "react-router-dom"

/** Legacy route — redirects to worksheet with configure panel open. */
export function PaymentSetupPage() {
  return <Navigate to="/manage/payment-run?configure=1" replace />
}
