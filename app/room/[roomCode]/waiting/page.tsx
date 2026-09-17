import WaitingRoomScreen from '../../../../components/WaitingRoomScreen';

export default async function Page({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = await params;
  return <WaitingRoomScreen code={roomCode} />;
}
