import { useState, useEffect } from 'react'
import socket from '../socket'

const CARD_STYLE = {
  Duke:       { bg: '#7c3aed', emoji: '💰' },
  Assassin:   { bg: '#111827', emoji: '🗡️' },
  Captain:    { bg: '#1d4ed8', emoji: '⚓' },
  Ambassador: { bg: '#15803d', emoji: '🤝' },
  Contessa:   { bg: '#be185d', emoji: '👑' },
  hidden:     { bg: '#374151', emoji: '?' },
}

function CardChip({ type, revealed, onClick, selected }) {
  const style = CARD_STYLE[type === 'hidden' ? 'hidden' : type] || CARD_STYLE.hidden
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
  const aliveTargets = game.players.filter(p => p.alive && p.id !== myId)

  // Auto-select the only target in a 2-player game
  useEffect(() => {
    if (aliveTargets.length === 1 && selectedTarget !== aliveTargets[0].id) {
      setSelectedTarget(aliveTargets[0].id)
    }
    if (aliveTargets.length === 0) setSelectedTarget(null)
  }, [aliveTargets.map(p => p.id).join(',')])

  const emit = (event, data, cb) => {
    socket.emit(event, data, (res) => {
      if (res?.error) setError(res.error)
      else { setError(null); cb?.() }
    })
  }

  const doAction = (type) => {
    if (['coup', 'assassinate', 'steal'].includes(type) && !selectedTarget) {
      return setError('Tap a target player first')
    }
    emit('take_action', { type, targetId: selectedTarget }, () => setSelectedTarget(null))
  }

  const react = (type, blockCard) => emit('react_to_action', { type, blockCard })
  const reactToBlock = (type) => emit('react_to_block', { type })
  const loseInfluence = (idx) => emit('lose_influence', { cardIndex: idx })

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
    if (!me?.alive) return (
      <div className="panel"><div className="panel-title">You are eliminated — spectating</div></div>
    )

    if (game.phase === 'ended') return (
      <div className="panel winner-panel">🎉 {game.winner} wins!</div>
    )

    // Lose influence
    if (turn?.phase === 'lose_influence' && turn.pendingLoseInfluence?.includes(myId)) {
      return (
        <div className="panel urgent">
          <div className="panel-title">Choose a card to reveal</div>
          <div className="card-row">
            {me.cards.map((card, i) => !card.revealed && (
              <CardChip key={i} type={card.type} revealed={false} onClick={() => loseInfluence(i)} />
            ))}
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
          <div className="panel-title">Keep {aliveCount} card(s) — pick from all {options.length}</div>
          <div className="card-row">
            {options.map((card, i) => {
              const key = `${card}-${i}`
              return (
                <CardChip key={key} type={card} revealed={false}
                  selected={exchangeSel.includes(key)}
                  onClick={() => toggleExchangeSel(card, i)} />
              )
            })}
          </div>
          <button className="primary" onClick={doExchange} disabled={exchangeSel.length !== aliveCount}>
            Confirm ({exchangeSel.length}/{aliveCount})
          </button>
        </div>
      )
    }

    // React to block
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
              {actor?.name} claims <strong>{action?.type.replace('_', ' ')}</strong>
            </div>
            <div className="btn-row">
              <button onClick={() => react('pass')}>Pass</button>
              {canChallenge && (
                <button className="danger" onClick={() => react('challenge')}>Challenge</button>
              )}
              {blockCards.map(card => (
                <button key={card}
                  style={{ background: CARD_STYLE[card]?.bg, color: 'white', borderColor: 'transparent' }}
                  onClick={() => react('block', card)}>
                  Block as {card}
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

      return <div className="panel"><div className="panel-title">Waiting for reactions...</div></div>
    }

    // My turn
    if (isMyTurn && turn?.phase === 'action') {
      const mustCoup = me.coins >= 10
      return (
        <div className="panel">
          <div className="panel-title">
            Your turn — {me.coins} coin{me.coins !== 1 ? 's' : ''}
            {mustCoup && <span className="must-coup"> — must Coup!</span>}
          </div>

          {/* Target picker — only show when >1 opponent */}
          {aliveTargets.length > 1 && (
            <div className="target-row">
              <span className="label">Target</span>
              {aliveTargets.map(p => (
                <button key={p.id}
                  className={`target-btn ${selectedTarget === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTarget(prev => prev === p.id ? null : p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* Basic actions */}
          <div className="action-section-label">Basic</div>
          <div className="actions-grid">
            <button onClick={() => doAction('income')} disabled={mustCoup}>
              Income <span className="sub">+1 coin</span>
            </button>
            <button onClick={() => doAction('foreign_aid')} disabled={mustCoup}>
              Foreign Aid <span className="sub">+2 · blockable</span>
            </button>
          </div>

          {/* Character actions — all always available (bluff!) */}
          <div className="action-section-label">
            Claim a Character <span className="bluff-hint">— bluff is allowed!</span>
          </div>
          <div className="actions-grid">
            <button onClick={() => doAction('tax')} disabled={mustCoup}
              className="action-card-btn">
              <span className="action-card-badge" style={{ background: CARD_STYLE.Duke.bg }}>Duke</span>
              Tax <span className="sub">+3 coins</span>
            </button>
            <button onClick={() => doAction('exchange')} disabled={mustCoup}
              className="action-card-btn">
              <span className="action-card-badge" style={{ background: CARD_STYLE.Ambassador.bg }}>Amb.</span>
              Exchange <span className="sub">swap cards</span>
            </button>
            <button onClick={() => doAction('steal')} disabled={mustCoup}
              className="action-card-btn">
              <span className="action-card-badge" style={{ background: CARD_STYLE.Captain.bg }}>Captain</span>
              Steal <span className="sub">2 coins from target</span>
            </button>
            <button
              onClick={() => doAction('assassinate')}
              disabled={mustCoup || me.coins < 3}
              className={`action-card-btn ${me.coins >= 3 ? 'danger' : ''}`}>
              <span className="action-card-badge" style={{ background: CARD_STYLE.Assassin.bg }}>Assn.</span>
              Assassinate <span className="sub">costs 3 coins</span>
            </button>
          </div>

          {/* Coup */}
          <div className="actions-grid" style={{ marginTop: '0.4rem' }}>
            <button
              onClick={() => doAction('coup')}
              disabled={me.coins < 7}
              className={me.coins >= 7 ? 'danger' : ''}>
              Coup <span className="sub">costs 7 coins — can't be blocked</span>
            </button>
          </div>
        </div>
      )
    }

    return <div className="panel"><div className="panel-title">Waiting for {currentPlayerName}...</div></div>
  }

  return (
    <div className="game">
      <div className="players-grid">
        {game.players.map((p) => {
          const isActive = game.players[game.turnIndex]?.id === p.id
          const isMe = p.id === myId
          return (
            <div key={p.id}
              className={`player-card ${!p.alive ? 'eliminated' : ''} ${isActive ? 'active' : ''} ${isMe ? 'me' : ''}`}>
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
