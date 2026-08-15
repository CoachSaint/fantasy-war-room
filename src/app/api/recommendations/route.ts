import { demoRecommendations } from "@/lib/demo";

export function GET() {
  return Response.json({
    data: demoRecommendations,
    demo: true,
    generatedAt: new Date().toISOString(),
  });
}
