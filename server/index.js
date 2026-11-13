const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  createGame, addPlayer, removePlayer, startGame,
  takeAction, reactToAction, reactToBlock,
  loseInfluence, exchangeCards, playerView, currentPlayer, nextTurn,
} = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();
const playerRoom = new Map();

function broadcast(game) {
  for (const player of game.players) {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) socket.emit('game_state', playerView(game, player.id));
  }
}

// When a player disconnects mid-game, unblock any waiting game state
function handleInGameDisconnect(game, socketId) {
  if (game.phase !== 'playing') return;
  const turn = game.turn;
  if (!turn) return;

  // Unblock awaiting_reactions — auto-pass for the disconnected player
  if (turn.phase === 'awaiting_reactions' && socketId in (turn.reactions || {})) {
    if (turn.reactions[socketId] === null) {
      reactToAction(game, socketId, { type: 'pass' });
    }
    return;
  }

  // Unblock awaiting_block_reaction — if disconnected actor, auto-allow the block
  if (turn.phase === 'awaiting_block_reaction' && turn.action?.actor === socketId) {
    reactToBlock(game, socketId, { type: 'allow' });
    return;
  }

  // Unblock lose_influence — auto-reveal first unrevealed card
  if (turn.phase === 'lose_influence' && turn.pendingLoseInfluence?.includes(socketId)) {
    const player = game.players.find(p => p.id === socketId);
    const idx = player?.cards.findIndex(c => !c.revealed) ?? -1;
    if (idx >= 0) loseInfluence(game, socketId, idx);
    return;
  }

  // Unblock awaiting_exchange — auto-keep first N cards
  if (turn.phase === 'awaiting_exchange' && turn.action?.actor === socketId) {
    const player = game.players.find(p => p.id === socketId);
    const aliveCount = player?.cards.filter(c => !c.revealed).length ?? 0;
    const kept = (turn.exchangeOptions || []).slice(0, aliveCount);
    if (kept.length === aliveCount) exchangeCards(game, socketId, kept);
    return;
  }

  // If it's the disconnected player's turn to act, skip to next
  if (turn.phase === 'action' && currentPlayer(game)?.id === socketId) {
    game.log.push(`${currentPlayer(game).name} disconnected — skipping turn`);
    nextTurn(game);
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    if (!name?.trim()) return cb({ error: 'Name required' });
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    const game = createGame(roomId);
    const result = addPlayer(game, socket.id, name.trim());
    if (result.error) return cb(result);
    rooms.set(roomId, game);
    playerRoom.set(socket.id, roomId);
    socket.join(roomId);
    broadcast(game);
    cb({ ok: true, roomId });
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    if (!name?.trim()) return cb({ error: 'Name required' });
    const id = roomId?.toUpperCase();
    const game = rooms.get(id);
    if (!game) return cb({ error: 'Room not found' });

    // Reconnection: if game is active and player with same name exists, restore their session
    if (game.phase === 'playing') {
      const existing = game.players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        playerRoom.delete(existing.id);
        existing.id = socket.id;
        playerRoom.set(socket.id, id);
        socket.join(id);
        socket.emit('game_state', playerView(game, socket.id));
        cb?.({ ok: true });
        return;
      }
    }

    const result = addPlayer(game, socket.id, name.trim());
    if (result.error) return cb(result);
    playerRoom.set(socket.id, id);
    socket.join(id);
    broadcast(game);
    cb({ ok: true });
  });

  socket.on('start_game', (cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    if (game.players[0]?.id !== socket.id) return cb?.({ error: 'Only the host can start' });
    const result = startGame(game);
    if (result.error) return cb?.(result);
    broadcast(game);
    cb?.({ ok: true });
  });

  socket.on('rename_player', ({ name }, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    if (game.phase !== 'lobby') return cb?.({ error: 'Can only rename before game starts' });
    if (!name?.trim()) return cb?.({ error: 'Name required' });
    const taken = game.players.find(p => p.id !== socket.id && p.name.toLowerCase() === name.trim().toLowerCase());
    if (taken) return cb?.({ error: 'Name already taken' });
    const player = game.players.find(p => p.id === socket.id);
    if (player) player.name = name.trim();
    broadcast(game);
    cb?.({ ok: true });
  });

  socket.on('take_action', (action, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = takeAction(game, socket.id, action);
    broadcast(game);
    cb?.(result);
  });

  socket.on('react_to_action', (reaction, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = reactToAction(game, socket.id, reaction);
    broadcast(game);
    cb?.(result);
  });

  socket.on('react_to_block', (reaction, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = reactToBlock(game, socket.id, reaction);
    broadcast(game);
    cb?.(result);
  });

  socket.on('lose_influence', ({ cardIndex }, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = loseInfluence(game, socket.id, cardIndex);
    broadcast(game);
    cb?.(result);
  });

  socket.on('exchange_cards', ({ keptCards }, cb) => {
    const game = rooms.get(playerRoom.get(socket.id));
    if (!game) return cb?.({ error: 'No room' });
    const result = exchangeCards(game, socket.id, keptCards);
    broadcast(game);
    cb?.(result);
  });

  socket.on('disconnect', () => {
    const roomId = playerRoom.get(socket.id);
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (game) {
      if (game.phase === 'lobby') {
        removePlayer(game, socket.id);
        if (game.players.length === 0) rooms.delete(roomId);
        else broadcast(game);
      } else if (game.phase === 'playing') {
        handleInGameDisconnect(game, socket.id);
        broadcast(game);
      }
    }
    playerRoom.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Coup server running on port ${PORT}`));
