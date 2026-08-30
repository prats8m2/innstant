/**
 * Guest entry point. A bare QR scan lands here and must render with ZERO
 * screens in the way — no login, no verification, no onboarding.
 * CLAUDE.md #9 and D-012. S7 implements the real resolution.
 */
export default async function RoomHome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  return <main>Room home for QR {qrCode}</main>;
}
