import { useState } from 'react'
import socket from '../socket'

const CARD_STYLE = {
  Duke:       { bg: '#7c3aed', emoji: '💰' },
  Assassin:   { bg: '#1f2937', emoji: '🗡️' },
  Captain:    { bg: '#1d4ed8', emoji: '⚓' },
  Ambassador: { bg: '#15803d', emoji: '🤝' },
  Contessa:   { bg: '#be185d', emoji: '👑' },
  hidden:     { bg: '#374151', emoji: '?' },
}

function CardChip({ type, revealed, onClick, selected }) {
  const style = CARD_STYLE[revealed ? type : (type === 'hidden' ? 'hidden' : type)] || CARD_STYLE.hidden
  return (
    <div
      className={`card-chip ${revealed ? 'revealed' : ''} ${selected ? 'selected' : ''} ${onClick ? 'clickable' : ''}`}
      style={{ background: revealed ? '#374151' : style.bg }}
      onClick={onClick}
    >
      {revealed ? '✗' : style.emoji} {type === 'hidden' ? '???' : type}
    </div>
  )
}

function getBlockCards(actionType, isTarget) {
  if (actionType === 'foreign_aid') return ['Duke']
  if (actionType === 'steal' && isTarget) return ['Captain', 'Ambassador']
  if (actionType === 'assassinate' && isTarget) return ['Contessa']
  return []
}

const CHALLENGEABLE = new Set(['tax', 'assassinate', 'steal', 'exchange'])

export default function GameBoard({ game, myId, setError, error }) {
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [exchangeSel, setExchangeSel] = useState([])

  const me = game.players.find(p => p.id === myId)
  const turn = game.turn
  const action = turn?.action
  const isMyTurn = game.players[game.turnIndex]?.id === myId
  const currentPlayerName = game.players[game.turnIndex]?.name

  const emit = (event, data, cb) => {
    socket.emit(event, data, (res) => {
      if (res?.error) setError(res.error)
      else { setError(null); cb?.() }
    })
  }

  const doAction = (type) => {
    if (['coup', 'assassinate', 'steal'].includes(type) && !selectedTarget) {
      return setError('Select a target first')
    }
    emit('take_action', { type, targetId: selectedTarget }, () => setSelectedTarget(null))
  }

  const react = (type, blockCard) => {
    emit('react_to_action', { type, blockCard })
  }

  const reactToBlock = (type) => {
    emit('react_to_block', { type })
  }

  const loseInfluence = (idx) => {
    emit('lose_influence', { cardIndex: idx })
  }

  const doExchange = () => {
    const aliveCount = me.cards.filter(c => !c.revealed).length
    if (exchangeSel.length !== aliveCount) return setError(`Pick exactly ${aliveCount} card(s)`)
    emit('exchange_cards', { keptCards: exchangeSel.map(k => k.split('-')[0]) }, () => setExchangeSel([]))
  }

  const toggleExchangeSel = (card, idx) => {
    const key = `${card}-${idx}`
    const aliveCount = me.cards.filter(c => !c.revealed).length
    setExchangeSel(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : prev.length < aliveCount ? [...prev, key] : prev
    )
  }

  const pendingReactors = Object.entries(turn?.reactions || {})
    .filter(([, r]) => r === null)
    .map(([id]) => game.players.find(p => p.id === id)?.name)
    .filter(Boolean)

  const renderPanel = () => {
    if (!me?.alive) {
      return (
        <div className="panel">
          <div className="panel-title">You are eliminated — spectating</div>
        </div>
      )
    }

    if (game.phase === 'ended') {
      return (
        <div className="panel winner-panel">
          🎉 {game.winner} wins!
        </div>
      )
    }

    // Lose influence
    if (turn?.phase === 'lose_influence' && turn.pendingLoseInfluence?.includes(myId)) {
      const loseCount = me.cards.filter(c => !c.revealed).length
      return (
        <div className="panel urgent">
          <div className="panel-title">Choose a card to reveal</div>
          <div className="card-row">
            {me.cards.map((card, i) =>
              !card.revealed && (
                <CardChip key={i} type={card.type} revealed={false} onClick={() => loseInfluence(i)} />
              )
            )}
          </div>
        </div>
      )
    }

    // Exchange
    if (turn?.phase === 'awaiting_exchange' && action?.actor === myId) {
      const aliveCount = me.cards.filter(c => !c.revealed).length
      const options = turn.exchangeOptions || []
      return (
        <div className="panel">
          <div className="panel-title">Keep {aliveCount} card(s)</div>
          <div className="card-row">
            {options.map((card, i) => {
              const key = `${card}-${i}`
              return (
                <CardChip
                  key={key}
                  type={card}
                  revealed={false}
                  selected={exchangeSel.includes(key)}
                  onClick={() => toggleExchangeSel(card, i)}
                />
              )
            })}
          </div>
          <button
            className="primary"
            onClick={doExchange}
            disabled={exchangeSel.length !== aliveCount}
          >
            Confirm ({exchangeSel.length}/{aliveCount})
          </button>
        </div>
      )
    }

    // React to block (only actor)
    if (turn?.phase === 'awaiting_block_reaction' && action?.actor === myId) {
      const blocker = game.players.find(p => p.id === turn.blocker)
      return (
        <div className="panel">
          <div className="panel-title">{blocker?.name} blocks with {turn.blockCard}</div>
          <div className="btn-row">
            <button onClick={() => reactToBlock('allow')}>Allow</button>
            <button className="danger" onClick={() => reactToBlock('challenge')}>Challenge Block</button>
          </div>
        </div>
      )
    }

    // React to action
    if (turn?.phase === 'awaiting_reactions') {
      const reactions = turn.reactions || {}
      const myReaction = reactions[myId]

      if (myId in reactions && myReaction === null) {
        const actor = game.players.find(p => p.id === action?.actor)
        const isTarget = action?.targetId === myId
        const blockCards = getBlockCards(action?.type, isTarget)
        const canChallenge = CHALLENGEABLE.has(action?.type)

        return (
          <div className="panel">
            <div className="panel-title">
              {actor?.name} plays <strong>{action?.type.replace('_', ' ')}</strong>
            </div>
            <div className="btn-row">
              <button onClick={() => react('pass')}>Pass</button>
              {canChallenge && (
                <button className="danger" onClick={() => react('challenge')}>Challenge</button>
              )}
              {blockCards.map(card => (
                <button
                  key={card}
                  style={{ background: CARD_STYLE[card]?.bg, color: 'white' }}
                  onClick={() => react('block', card)}
                >
                  Block ({card})
                </button>
              ))}
            </div>
          </div>
        )
      }

      if (myId in reactions && myReaction !== null) {
        return (
          <div className="panel">
            <div className="panel-title">Waiting for: {pendingReactors.join(', ') || '...'}</div>
          </div>
        )
      }

      // Waiting but not in reactions (e.g. we're not an other player?)
      return (
        <div className="panel">
          <div className="panel-title">Waiting for reactions...</div>
        </div>
      )
    }

    // My turn action selection
    if (isMyTurn && turn?.phase === 'action') {
      const alive = game.players.filter(p => p.alive && p.id !== myId)
      const mustCoup = me.coins >= 10
      return (
        <div className="panel">
          <div className="panel-title">
            Your turn — {me.coins} coin{me.coins !== 1 ? 's' : ''}
            {mustCoup && <span className="must-coup"> (must Coup!)</span>}
          </div>

          {alive.length > 0 && (
            <div className="target-row">
              <span className="label">Target:</span>
              {alive.map(p => (
                <button
                  key={p.id}
                  className={`target-btn ${selectedTarget === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTarget(prev => prev === p.id ? null : p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div className="actions-grid">
            <button onClick={() => doAction('income')} disabled={mustCoup}>
              Income <span className="sub">+1 coin</span>
            </button>
            <button onClick={() => doAction('foreign_aid')} disabled={mustCoup}>
              Foreign Aid <span className="sub">+2 · blockable</span>
            </button>
            <button onClick={() => doAction('tax')} disabled={mustCoup}
              style={{ borderLeft: `3px solid ${CARD_STYLE.Duke.bg}` }}>
              {CARD_STYLE.Duke.emoji} Tax <span className="sub">+3 · Duke</span>
            </button>
            <button onClick={() => doAction('exchange')} disabled={mustCoup}
              style={{ borderLeft: `3px solid ${CARD_STYLE.Ambassador.bg}` }}>
              {CARD_STYLE.Ambassador.emoji} Exchange <span className="sub">Ambassador</span>
            </button>
            <button
              onClick={() => doAction('steal')}
              disabled={mustCoup || !selectedTarget}
              style={{ borderLeft: `3px solid ${CARD_STYLE.Captain.bg}` }}
            >
              {CARD_STYLE.Captain.emoji} Steal <span className="sub">Captain</span>
            </button>
            <button
              className={me.coins >= 3 ? 'danger' : ''}
              onClick={() => doAction('assassinate')}
              disabled={mustCoup || me.coins < 3 || !selectedTarget}
              style={{ borderLeft: `3px solid ${CARD_STYLE.Assassin.bg}` }}
            >
              {CARD_STYLE.Assassin.emoji} Assassinate <span className="sub">3 coins · Assassin</span>
            </button>
            <button
              className={me.coins >= 7 ? 'danger' : ''}
              onClick={() => doAction('coup')}
              disabled={me.coins < 7 || !selectedTarget}
            >
              Coup <span className="sub">7 coins</span>
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="panel">
        <div className="panel-title">Waiting for {currentPlayerName}...</div>
      </div>
    )
  }

  return (
    <div className="game">
      <div className="players-grid">
        {game.players.map((p) => {
          const isActive = game.players[game.turnIndex]?.id === p.id
          const isMe = p.id === myId
          return (
            <div
              key={p.id}
              className={`player-card ${!p.alive ? 'eliminated' : ''} ${isActive ? 'active' : ''} ${isMe ? 'me' : ''}`}
            >
              <div className="player-header">
                <span className="player-name">{p.name}{isMe ? ' (you)' : ''}</span>
                <span className="coins">💰 {p.coins}</span>
              </div>
              <div className="player-cards">
                {p.cards.map((card, i) => (
                  <CardChip key={i} type={card.type} revealed={card.revealed} />
                ))}
              </div>
              {!p.alive && <div className="eliminated-label">eliminated</div>}
            </div>
          )
        })}
      </div>

      {renderPanel()}

      {error && <div className="error">{error}</div>}

      <div className="log">
        <div className="log-title">Game Log</div>
        <div className="log-entries">
          {[...game.log].reverse().map((entry, i) => (
            <div key={i} className={`log-entry ${i === 0 ? 'latest' : ''}`}>{entry}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
