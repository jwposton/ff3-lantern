import { createBrowserRouter } from "react-router-dom"

import { RequireAuth, RequirePermission } from "@/components/RequireAuth"
import { AppShell } from "@/layouts/AppShell"
import { DashboardPage } from "@/pages/DashboardPage"
import { SpendingBarPage } from "@/pages/SpendingBarPage"
import { SpendingLinePage } from "@/pages/SpendingLinePage"
import { SpendingSankeyPage } from "@/pages/SpendingSankeyPage"
import { CashFlowBarPage } from "@/pages/CashFlowBarPage"
import { CashFlowLinePage } from "@/pages/CashFlowLinePage"
import { CashFlowSankeyPage } from "@/pages/CashFlowSankeyPage"
import { CashFlowMomPage } from "@/pages/CashFlowMomPage"
import { SpendingMomPage } from "@/pages/SpendingMomPage"
import { TransactionExplorerPage } from "@/pages/TransactionExplorerPage"
import { CategorizePage } from "@/pages/CategorizePage"
import { LoansPage } from "@/pages/LoansPage"
import { LoanProfilePage } from "@/pages/LoanProfilePage"
import { LoanSplitsQueuePage } from "@/pages/LoanSplitsQueuePage"
import { AboutPage } from "@/pages/AboutPage"
import { ChangePasswordPage } from "@/pages/ChangePasswordPage"
import { LoginPage } from "@/pages/LoginPage"
import { PaymentWorksheetPage } from "@/pages/PaymentWorksheetPage"
import { PaymentSetupPage } from "@/pages/PaymentSetupPage"
import { BillGroupsPage } from "@/pages/BillGroupsPage"
import { PaymentBucketsPage } from "@/pages/PaymentBucketsPage"
import { CreditCardDetailPage } from "@/pages/CreditCardDetailPage"
import { PaymentCardsPage } from "@/pages/PaymentCardsPage"
import { LiabilitiesHubPage } from "@/pages/LiabilitiesHubPage"
import { LiabilityDetailPage } from "@/pages/LiabilityDetailPage"
import { BillDiscoverPage } from "@/pages/BillDiscoverPage"
import { BillsDetailPage } from "@/pages/BillsDetailPage"
import { ExternalLinksPage } from "@/pages/ExternalLinksPage"
import type { ReactElement } from "react"

function guard(resource: string, element: ReactElement) {
  return <RequirePermission resource={resource}>{element}</RequirePermission>
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/change-password",
    element: <ChangePasswordPage />,
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "reports/transactions",
        element: guard("transactions", <TransactionExplorerPage />),
      },
      {
        path: "manage/categorize",
        element: guard("categorize", <CategorizePage />),
      },
      {
        path: "manage/loans",
        element: guard("loans", <LoansPage />),
      },
      {
        path: "manage/loans/queue",
        element: guard("loans", <LoanSplitsQueuePage />),
      },
      {
        path: "manage/loans/:accountId",
        element: guard("loans", <LoanProfilePage />),
      },
      {
        path: "manage/payment-run",
        element: guard("payment_worksheet", <PaymentWorksheetPage />),
      },
      {
        path: "manage/payment-run/setup",
        element: guard("payment_setup", <PaymentSetupPage />),
      },
      {
        path: "manage/payment-run/buckets",
        element: guard("payment_setup", <PaymentBucketsPage />),
      },
      {
        path: "manage/payment-run/external-links",
        element: guard("payment_setup", <ExternalLinksPage />),
      },
      {
        path: "manage/payment-run/bill-groups",
        element: guard("payment_setup", <BillGroupsPage />),
      },
      {
        path: "manage/payment-run/cards",
        element: guard("payment_setup", <PaymentCardsPage />),
      },
      {
        path: "manage/payment-run/cards/:accountId",
        element: guard("payment_setup", <CreditCardDetailPage />),
      },
      {
        path: "manage/payment-run/discover",
        element: guard("bill_discover", <BillDiscoverPage />),
      },
      {
        path: "manage/liabilities",
        element: guard("liabilities", <LiabilitiesHubPage />),
      },
      {
        path: "manage/liabilities/:accountId",
        element: guard("liabilities", <LiabilityDetailPage />),
      },
      {
        path: "manage/bills",
        element: guard("bills", <BillsDetailPage />),
      },
      {
        path: "manage/bills/:registryId",
        element: guard("bills", <BillsDetailPage />),
      },
      {
        path: "reports/spending",
        element: guard("reports", <SpendingBarPage />),
      },
      {
        path: "reports/spending/trends",
        element: guard("reports", <SpendingLinePage />),
      },
      {
        path: "reports/spending/sankey",
        element: guard("reports", <SpendingSankeyPage />),
      },
      {
        path: "reports/spending/mom",
        element: guard("reports", <SpendingMomPage />),
      },
      {
        path: "reports/cash-flow",
        element: guard("reports", <CashFlowBarPage />),
      },
      {
        path: "reports/cash-flow/trends",
        element: guard("reports", <CashFlowLinePage />),
      },
      {
        path: "reports/cash-flow/sankey",
        element: guard("reports", <CashFlowSankeyPage />),
      },
      {
        path: "reports/cash-flow/mom",
        element: guard("reports", <CashFlowMomPage />),
      },
      {
        path: "about",
        element: <AboutPage />,
      },
    ],
  },
])
