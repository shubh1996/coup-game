const CARDS = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  const deck = [];
  for (const card of CARDS) {
    for (let i = 0; i < 3; i++) deck.push(card);
  }
  return shuffle(deck);
}

function createGame(roomId) {
  return {
    id: roomId,
    phase: 'lobby',
    players: [],
    deck: [],
    turnIndex: 0,
    turn: null,
    log: [],
    winner: null,
  };
}

function addPlayer(game, socketId, name) {
  if (game.phase !== 'lobby') return { error: 'Game already started' };
  if (game.players.length >= 6) return { error: 'Room is full' };
  if (game.players.find(p => p.name.toLowerCase() === name.toLowerCase())) return { error: 'Name already taken' };
  game.players.push({ id: socketId, name, coins: 2, cards: [], alive: true });
  return { ok: true };
}

function startGame(game) {
  if (game.players.length < 2) return { error: 'Need at least 2 players' };
  game.deck = createDeck();
  for (const player of game.players) {
    player.coins = 2;
    player.cards = [
      { type: game.deck.pop(), revealed: false },
      { type: game.deck.pop(), revealed: false },
    ];
    player.alive = true;
  }
  game.phase = 'playing';
  game.turnIndex = 0;
  game.log = ['Game started! Good luck.'];
  startTurn(game);
  return { ok: true };
}

function startTurn(game) {
  const player = currentPlayer(game);
  game.turn = {
    phase: 'action',
    action: null,
    reactions: {},
    blocker: null,
    blockCard: null,
    pendingLoseInfluence: [],
    executeAfterLoss: false,
    exchangeOptions: null,
  };
  game.log.push(`--- ${player.name}'s turn ---`);
}

function currentPlayer(game) {
  return game.players[game.turnIndex];
}

function nextTurn(game) {
  const alive = game.players.filter(p => p.alive);
  if (alive.length <= 1) {
    game.phase = 'ended';
    game.winner = alive[0]?.name || 'Nobody';
    game.log.push(`🎉 ${game.winner} wins the game!`);
    return;
  }
  do {
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
  } while (!game.players[game.turnIndex].alive);
  startTurn(game);
}

function playerView(game, socketId) {
  return {
    ...game,
    players: game.players.map(p => ({
      ...p,
      cards: p.cards.map(c => ({
        ...c,
        type: (p.id === socketId || c.revealed) ? c.type : 'hidden',
      })),
    })),
  };
}

function getBlockCards(actionType, isTarget) {
  switch (actionType) {
    case 'foreign_aid': return ['Duke'];
    case 'steal': return isTarget ? ['Captain', 'Ambassador'] : [];
    case 'assassinate': return isTarget ? ['Contessa'] : [];
    default: return [];
  }
}

const CHALLENGEABLE_ACTIONS = new Set(['tax', 'assassinate', 'steal', 'exchange']);
const CLAIMED_CARD = {
  tax: 'Duke',
  assassinate: 'Assassin',
  steal: 'Captain',
  exchange: 'Ambassador',
};

function takeAction(game, socketId, action) {
  const player = game.players.find(p => p.id === socketId);
  if (!player?.alive) return { error: 'Not a valid player' };
  if (currentPlayer(game).id !== socketId) return { error: 'Not your turn' };
  if (game.turn.phase !== 'action') return { error: 'Wrong phase' };

  const { type, targetId } = action;
  const target = targetId ? game.players.find(p => p.id === targetId) : null;
  if (targetId && (!target?.alive)) return { error: 'Invalid target' };

  if (player.coins >= 10 && type !== 'coup') return { error: 'You must Coup with 10+ coins' };
  if (type === 'coup' && player.coins < 7) return { error: 'Need 7 coins to Coup' };
  if (type === 'coup' && !targetId) return { error: 'Must target a player' };
  if (type === 'assassinate' && player.coins < 3) return { error: 'Need 3 coins to Assassinate' };
  if (type === 'assassinate' && !targetId) return { error: 'Must target a player' };
  if (type === 'steal' && !targetId) return { error: 'Must target a player' };

  const labels = {
    income: 'takes Income (+1)',
    foreign_aid: 'takes Foreign Aid (+2)',
    coup: `Coups ${target?.name}`,
    tax: `claims Duke — Tax (+3)`,
    assassinate: `claims Assassin — Assassinates ${target?.name}`,
    steal: `claims Captain — Steals from ${target?.name}`,
    exchange: `claims Ambassador — Exchange`,
  };
  game.log.push(`${player.name} ${labels[type] || type}`);
  game.turn.action = { type, actor: socketId, targetId };

  if (type === 'income') {
    player.coins += 1;
    nextTurn(game);
    return { ok: true };
  }

  if (type === 'coup') {
    player.coins -= 7;
    game.turn.phase = 'lose_influence';
    game.turn.pendingLoseInfluence = [targetId];
    game.log.push(`${target.name} must reveal an influence`);
    return { ok: true };
  }

  // Pay assassinate upfront
  if (type === 'assassinate') {
    player.coins -= 3;
  }

  // All other actions go to reaction phase
  game.turn.phase = 'awaiting_reactions';
  const others = game.players.filter(p => p.alive && p.id !== socketId);
  for (const p of others) game.turn.reactions[p.id] = null;

  if (others.length === 0) {
    return executeAction(game);
  }

  return { ok: true };
}

function reactToAction(game, socketId, reaction) {
  if (game.turn.phase !== 'awaiting_reactions') return { error: 'Wrong phase' };
  if (!(socketId in game.turn.reactions)) return { error: 'Not your reaction' };
  if (game.turn.reactions[socketId] !== null) return { error: 'Already reacted' };

  const { type, blockCard } = reaction;
  const player = game.players.find(p => p.id === socketId);
  const action = game.turn.action;

  if (type === 'challenge') {
    if (!CHALLENGEABLE_ACTIONS.has(action.type)) return { error: 'This action cannot be challenged' };
    game.turn.reactions[socketId] = { type };
    game.log.push(`${player.name} challenges!`);
    return resolveActionChallenge(game, socketId);
  }

  if (type === 'block') {
    const valid = getBlockCards(action.type, action.targetId === socketId);
    if (!valid.length) return { error: 'Cannot block this action' };
    if (!blockCard || !valid.includes(blockCard)) return { error: `Block with: ${valid.join(' or ')}` };
    game.turn.reactions[socketId] = { type, blockCard };
    game.turn.blocker = socketId;
    game.turn.blockCard = blockCard;
    game.turn.phase = 'awaiting_block_reaction';
    game.log.push(`${player.name} blocks with ${blockCard}`);
    return { ok: true };
  }

  // pass
  game.turn.reactions[socketId] = { type: 'pass' };
  const allPassed = Object.values(game.turn.reactions).every(r => r?.type === 'pass');
  if (allPassed) return executeAction(game);
  return { ok: true };
}

function reactToBlock(game, socketId, reaction) {
  if (game.turn.phase !== 'awaiting_block_reaction') return { error: 'Wrong phase' };
  if (game.turn.action.actor !== socketId) return { error: 'Only the actor can react to a block' };

  const actor = game.players.find(p => p.id === socketId);
  const blocker = game.players.find(p => p.id === game.turn.blocker);

  if (reaction.type === 'allow') {
    game.log.push(`${actor.name} allows the block — action cancelled`);
    nextTurn(game);
    return { ok: true };
  }

  if (reaction.type === 'challenge') {
    game.log.push(`${actor.name} challenges ${blocker.name}'s ${game.turn.blockCard}!`);
    return resolveBlockChallenge(game, socketId);
  }

  return { error: 'Invalid reaction' };
}

function resolveActionChallenge(game, challengerId) {
  const action = game.turn.action;
  const actor = game.players.find(p => p.id === action.actor);
  const challenger = game.players.find(p => p.id === challengerId);
  const claimed = CLAIMED_CARD[action.type];

  const cardIdx = actor.cards.findIndex(c => !c.revealed && c.type === claimed);
  if (cardIdx !== -1) {
    // Challenge fails — challenger loses influence, actor gets new card
    game.log.push(`${actor.name} reveals ${claimed}! Challenge fails — ${challenger.name} loses an influence`);
    game.deck.push(actor.cards[cardIdx].type);
    game.deck = shuffle(game.deck);
    actor.cards[cardIdx] = { type: game.deck.pop(), revealed: false };
    game.turn.pendingLoseInfluence = [challengerId];
    game.turn.executeAfterLoss = true;
    game.turn.phase = 'lose_influence';
  } else {
    // Challenge succeeds — actor loses influence, action cancelled
    game.log.push(`${actor.name} can't show ${claimed}! Challenge succeeds — ${actor.name} loses an influence`);
    game.turn.pendingLoseInfluence = [action.actor];
    game.turn.executeAfterLoss = false;
    game.turn.phase = 'lose_influence';
    // Refund assassinate coins if action is cancelled
    if (action.type === 'assassinate') actor.coins += 3;
  }
  return { ok: true };
}

function resolveBlockChallenge(game, actorId) {
  const blocker = game.players.find(p => p.id === game.turn.blocker);
  const actor = game.players.find(p => p.id === actorId);
  const blockCard = game.turn.blockCard;

  const cardIdx = blocker.cards.findIndex(c => !c.revealed && c.type === blockCard);
  if (cardIdx !== -1) {
    // Block challenge fails — actor loses influence, block stands
    game.log.push(`${blocker.name} reveals ${blockCard}! Block challenge fails — ${actor.name} loses an influence`);
    game.deck.push(blocker.cards[cardIdx].type);
    game.deck = shuffle(game.deck);
    blocker.cards[cardIdx] = { type: game.deck.pop(), revealed: false };
    game.turn.pendingLoseInfluence = [actorId];
    game.turn.executeAfterLoss = false;
    game.turn.phase = 'lose_influence';
  } else {
    // Block challenge succeeds — blocker loses influence, action executes
    game.log.push(`${blocker.name} can't show ${blockCard}! Block challenge succeeds — ${blocker.name} loses an influence`);
    game.turn.pendingLoseInfluence = [game.turn.blocker];
    game.turn.executeAfterLoss = true;
    game.turn.phase = 'lose_influence';
  }
  return { ok: true };
}

function loseInfluence(game, socketId, cardIndex) {
  if (game.turn.phase !== 'lose_influence') return { error: 'Wrong phase' };
  if (!game.turn.pendingLoseInfluence.includes(socketId)) return { error: 'Not your turn to lose influence' };

  const player = game.players.find(p => p.id === socketId);
  const card = player.cards[cardIndex];
  if (!card || card.revealed) return { error: 'Invalid card choice' };

  card.revealed = true;
  game.log.push(`${player.name} reveals ${card.type}`);

  if (player.cards.every(c => c.revealed)) {
    player.alive = false;
    game.log.push(`${player.name} is eliminated!`);
  }

  game.turn.pendingLoseInfluence = game.turn.pendingLoseInfluence.filter(id => id !== socketId);
  if (game.turn.pendingLoseInfluence.length > 0) return { ok: true };

  const alive = game.players.filter(p => p.alive);
  if (alive.length <= 1) {
    game.phase = 'ended';
    game.winner = alive[0]?.name || 'Nobody';
    game.log.push(`🎉 ${game.winner} wins the game!`);
    return { ok: true };
  }

  if (game.turn.executeAfterLoss) return executeAction(game);
  nextTurn(game);
  return { ok: true };
}

function executeAction(game) {
  const action = game.turn.action;
  const actor = game.players.find(p => p.id === action.actor);
  const target = action.targetId ? game.players.find(p => p.id === action.targetId) : null;

  switch (action.type) {
    case 'foreign_aid':
      actor.coins += 2;
      game.log.push(`${actor.name} gains 2 coins (now ${actor.coins})`);
      nextTurn(game);
      break;

    case 'tax':
      actor.coins += 3;
      game.log.push(`${actor.name} gains 3 coins (now ${actor.coins})`);
      nextTurn(game);
      break;

    case 'steal': {
      const stolen = Math.min(2, target.coins);
      target.coins -= stolen;
      actor.coins += stolen;
      game.log.push(`${actor.name} steals ${stolen} coin(s) from ${target.name}`);
      nextTurn(game);
      break;
    }

    case 'assassinate':
      if (!target?.alive) {
        // Target was somehow eliminated, just next turn
        nextTurn(game);
      } else {
        game.turn.phase = 'lose_influence';
        game.turn.pendingLoseInfluence = [action.targetId];
        game.turn.executeAfterLoss = false;
        game.log.push(`${target.name} must lose an influence (assassinated)`);
      }
      break;

    case 'exchange': {
      const drawn = [];
      for (let i = 0; i < 2 && game.deck.length > 0; i++) drawn.push(game.deck.pop());
      const held = actor.cards.filter(c => !c.revealed).map(c => c.type);
      game.turn.exchangeOptions = [...held, ...drawn];
      game.turn.phase = 'awaiting_exchange';
      game.log.push(`${actor.name} draws cards for exchange`);
      break;
    }
  }
  return { ok: true };
}

function exchangeCards(game, socketId, keptCards) {
  if (game.turn.phase !== 'awaiting_exchange') return { error: 'Wrong phase' };
  if (game.turn.action.actor !== socketId) return { error: 'Not your exchange' };

  const player = game.players.find(p => p.id === socketId);
  const options = [...game.turn.exchangeOptions];
  const aliveCount = player.cards.filter(c => !c.revealed).length;

  if (keptCards.length !== aliveCount) return { error: `Keep exactly ${aliveCount} card(s)` };

  const pool = [...options];
  for (const card of keptCards) {
    const idx = pool.indexOf(card);
    if (idx === -1) return { error: 'Invalid card selection' };
    pool.splice(idx, 1);
  }

  let kIdx = 0;
  for (const card of player.cards) {
    if (!card.revealed) card.type = keptCards[kIdx++];
  }

  for (const card of pool) game.deck.push(card);
  game.deck = shuffle(game.deck);
  game.log.push(`${player.name} completes exchange`);
  nextTurn(game);
  return { ok: true };
}

function removePlayer(game, socketId) {
  if (game.phase !== 'lobby') return;
  game.players = game.players.filter(p => p.id !== socketId);
}

module.exports = {
  createGame, addPlayer, removePlayer, startGame,
  takeAction, reactToAction, reactToBlock,
  loseInfluence, exchangeCards, playerView, currentPlayer,
};
