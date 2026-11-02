import { useState, useEffect } from 'react'
import socket from './socket'
import Lobby from './components/Lobby'
import GameBoard from './components/GameBoard'

export default function App() {
  const [game, setGame] = useState(null)
  const [myId, setMyId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id))
    socket.on('game_state', (state) => {
      setGame(state)
      setError(null)
    })
    if (socket.connected) setMyId(socket.id)
    return () => {
      socket.off('connect')
      socket.off('game_state')
    }
  }, [])

  if (!game || game.phase === 'lobby') {
    return <Lobby game={game} myId={myId} setError={setError} error={error} />
  }

  return <GameBoard game={game} myId={myId} setError={setError} error={error} />
}
