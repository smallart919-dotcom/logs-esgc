import { createFileRoute, Link } from "@tanstack/react-router";
import { WeatherView } from "@/components/weather-view";

export const Route = createFileRoute("/weather")({
  head: () => ({
    meta: [
      { title: "Weather — ESGC" },
      { name: "description", content: "METAR, TAF, Windy and RASP forecasts for Ringmer, Deanland and nearby aerodromes." },
      { property: "og:title", content: "Weather — ESGC" },
      { property: "og:description", content: "METAR, TAF, Windy and RASP for the day." },
    ],
  }),
  component: WeatherPage,
});

function WeatherPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">🌦 Weather</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live observations, forecasts and soaring conditions for the day.
          </p>
        </div>
        <Link to="/map" className="text-sm text-primary hover:underline">← Back to map</Link>
      </div>
      <WeatherView variant="page" />
    </div>
  );
}
