import { createBrowserRouter } from "react-router-dom"

import { AppShell } from "@/layouts/AppShell"
import { DashboardPage } from "@/pages/DashboardPage"
import { ReportStubPage } from "@/pages/ReportStubPage"
import { SpendingTrendsPage } from "@/pages/SpendingTrendsPage"
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
        path: "reports/trends",
        element: <SpendingTrendsPage />,
      },
      {
        path: "reports/bar",
        element: (
          <ReportStubPage reportName="Bar & Drilldown" deliveryPhase={6} />
        ),
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
