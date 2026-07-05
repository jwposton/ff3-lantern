import { createBrowserRouter } from "react-router-dom"

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
import { PaymentWorksheetPage } from "@/pages/PaymentWorksheetPage"
import { PaymentSetupPage } from "@/pages/PaymentSetupPage"
import { BillGroupsPage } from "@/pages/BillGroupsPage"
import { PaymentBucketsPage } from "@/pages/PaymentBucketsPage"
import { PaymentCardsPage } from "@/pages/PaymentCardsPage"
import { LiabilitiesHubPage } from "@/pages/LiabilitiesHubPage"
import { BillDiscoverPage } from "@/pages/BillDiscoverPage"
import { BillsDetailPage } from "@/pages/BillsDetailPage"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: "reports/transactions",
        element: <TransactionExplorerPage />,
      },
      {
        path: "manage/categorize",
        element: <CategorizePage />,
      },
      {
        path: "manage/loans",
        element: <LoansPage />,
      },
      {
        path: "manage/loans/queue",
        element: <LoanSplitsQueuePage />,
      },
      {
        path: "manage/loans/:accountId",
        element: <LoanProfilePage />,
      },
      {
        path: "manage/payment-run",
        element: <PaymentWorksheetPage />,
      },
      {
        path: "manage/payment-run/setup",
        element: <PaymentSetupPage />,
      },
      {
        path: "manage/payment-run/buckets",
        element: <PaymentBucketsPage />,
      },
      {
        path: "manage/payment-run/bill-groups",
        element: <BillGroupsPage />,
      },
      {
        path: "manage/payment-run/cards",
        element: <PaymentCardsPage />,
      },
      {
        path: "manage/payment-run/discover",
        element: <BillDiscoverPage />,
      },
      {
        path: "manage/liabilities",
        element: <LiabilitiesHubPage />,
      },
      {
        path: "manage/bills",
        element: <BillsDetailPage />,
      },
      {
        path: "manage/bills/:registryId",
        element: <BillsDetailPage />,
      },
      {
        path: "reports/spending",
        element: <SpendingBarPage />,
      },
      {
        path: "reports/spending/trends",
        element: <SpendingLinePage />,
      },
      {
        path: "reports/spending/sankey",
        element: <SpendingSankeyPage />,
      },
      {
        path: "reports/spending/mom",
        element: <SpendingMomPage />,
      },
      {
        path: "reports/cash-flow",
        element: <CashFlowBarPage />,
      },
      {
        path: "reports/cash-flow/trends",
        element: <CashFlowLinePage />,
      },
      {
        path: "reports/cash-flow/sankey",
        element: <CashFlowSankeyPage />,
      },
      {
        path: "reports/cash-flow/mom",
        element: <CashFlowMomPage />,
      },
      {
        path: "about",
        element: <AboutPage />,
      },
    ],
  },
])
