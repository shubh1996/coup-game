import { useState } from 'react'
import socket from '../socket'

export default function Lobby({ game, myId, setError, error }) {
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [joined, setJoined] = useState(false)

  const createRoom = () => {
    if (!name.trim()) return setError('Enter your name')
    socket.emit('create_room', { name: name.trim() }, (res) => {
      if (res.error) setError(res.error)
      else { setJoined(true); setError(null) }
    })
  }

  const joinRoom = () => {
    if (!name.trim()) return setError('Enter your name')
    if (!roomCode.trim()) return setError('Enter a room code')
    socket.emit('join_room', { roomId: roomCode.trim(), name: name.trim() }, (res) => {
      if (res.error) setError(res.error)
      else { setJoined(true); setError(null) }
    })
  }

  const startGame = () => {
    socket.emit('start_game', (res) => {
      if (res?.error) setError(res.error)
    })
  }

  const isHost = game?.players[0]?.id === myId

  if (joined && game) {
    return (
      <div className="lobby">
        <h1>Coup</h1>
        <div className="room-code-box">
          <span className="room-label">Room Code</span>
          <span className="room-id">{game.id}</span>
        </div>
        <p className="hint">Share this code with your friends</p>

        <div className="player-list">
          {game.players.map((p, i) => (
            <div key={p.id} className="player-entry">
              <span>{i === 0 ? '👑 ' : '  '}{p.name}</span>
              {p.id === myId && <span className="you-tag">you</span>}
            </div>
          ))}
        </div>

        {isHost ? (
          <button
            className="primary"
            onClick={startGame}
            disabled={game.players.length < 2}
          >
            {game.players.length < 2 ? 'Waiting for players...' : 'Start Game'}
          </button>
        ) : (
          <p className="hint">Waiting for host to start the game...</p>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="lobby">
      <h1>Coup</h1>
      <p className="tagline">Bluff. Challenge. Survive.</p>

      <div className="lobby-form">
        <input
          placeholder="Your name"
          value={name}
          maxLength={20}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createRoom()}
        />
        <button className="primary" onClick={createRoom}>Create Room</button>
        <div className="or-divider">— or —</div>
        <input
          placeholder="Room code"
          value={roomCode}
          onChange={e => setRoomCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && joinRoom()}
          maxLength={5}
        />
        <button onClick={joinRoom}>Join Room</button>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  )
}
