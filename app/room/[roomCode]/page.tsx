import PhaseTwo from '../../../components/PhaseTwo';
export default async function Page({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  return <PhaseTwo screen="room" code={roomCode} />;
}
