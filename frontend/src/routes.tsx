import { createBrowserRouter } from "react-router-dom"

import { AppShell } from "@/layouts/AppShell"
import { DashboardPage } from "@/pages/DashboardPage"
import { SpendingBarPage } from "@/pages/SpendingBarPage"
import { SpendingLinePage } from "@/pages/SpendingLinePage"
import { SpendingSankeyPage } from "@/pages/SpendingSankeyPage"
import { CashFlowBarPage } from "@/pages/CashFlowBarPage"
import { CashFlowLinePage } from "@/pages/CashFlowLinePage"
import { CashFlowSankeyPage } from "@/pages/CashFlowSankeyPage"
import { TransactionExplorerPage } from "@/pages/TransactionExplorerPage"

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
    ],
  },
])
