import { createBrowserRouter } from "react-router-dom"

import { AppShell } from "@/layouts/AppShell"
import { DashboardPage } from "@/pages/DashboardPage"
import { ReportStubPage } from "@/pages/ReportStubPage"
import { SpendingBarPage } from "@/pages/SpendingBarPage"
import { SpendingLinePage } from "@/pages/SpendingLinePage"
import { CashFlowBarPage } from "@/pages/CashFlowBarPage"
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
        path: "reports/cash-flow",
        element: <CashFlowBarPage />,
      },
      {
        path: "reports/sankey",
        element: (
          <ReportStubPage reportName="Sankey Flows" deliveryPhase={7} />
        ),
      },
    ],
  },
])
