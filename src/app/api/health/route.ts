export function GET() {
  return Response.json({ ok: true, service: "fantasy-war-room", time: new Date().toISOString() });
}
