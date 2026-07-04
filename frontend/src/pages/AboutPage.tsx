import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AppLogo } from "@/components/AppLogo"
import { AppVersionBadge } from "@/components/AppVersionBadge"
import { ComparisonGraphIcon } from "@/components/icons/ComparisonGraphIcon"
import { SankeyChartIcon } from "@/components/icons/SankeyChartIcon"
import { formatAppVersion } from "@/lib/appVersion"
import {
  CHANGELOG_URL,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from "@/lib/product"

const NOUN_PROJECT_ATTRIBUTIONS = [
  {
    name: "Sankey Chart",
    creator: "Kirby Wu",
    href: "https://thenounproject.com/browse/icons/term/sankey-chart/",
    license: "CC BY 3.0",
    Icon: SankeyChartIcon,
    usage: "Sankey report navigation",
  },
  {
    name: "age picture diagram",
    creator: "birdpeople",
    href: "https://thenounproject.com/browse/icons/term/age-picture-diagram/",
    license: "CC BY 3.0",
    Icon: ComparisonGraphIcon,
    usage: "Variance report navigation",
  },
] as const

export function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AppLogo size={32} />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">About</h1>
            <AppVersionBadge className="text-sm" />
          </div>
        </div>
        <p className="text-lg font-medium tracking-tight">{PRODUCT_NAME}</p>
        <p className="text-muted-foreground">{PRODUCT_TAGLINE}</p>
        <p className="text-sm text-muted-foreground">
          Release notes:{" "}
          <a
            href={CHANGELOG_URL}
            className="text-primary underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {formatAppVersion()} changelog
          </a>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Icon attributions</CardTitle>
          <CardDescription>
            Navigation icons from{" "}
            <a
              href="https://thenounproject.com/"
              className="text-primary underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              The Noun Project
            </a>{" "}
            (CC BY 3.0). Other sidebar icons are from{" "}
            <a
              href="https://lucide.dev/"
              className="text-primary underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Lucide
            </a>
            . The app mark is an original flame design.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {NOUN_PROJECT_ATTRIBUTIONS.map(
              ({ name, creator, href, license, Icon, usage }) => (
                <li
                  key={href}
                  className="flex gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium">{name}</p>
                    <p className="text-muted-foreground">
                      {name} by {creator} from{" "}
                      <a
                        href={href}
                        className="text-primary underline-offset-4 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${name} Icons`}
                      >
                        Noun Project
                      </a>{" "}
                      ({license})
                    </p>
                    <p className="text-muted-foreground">{usage}</p>
                  </div>
                </li>
              ),
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
